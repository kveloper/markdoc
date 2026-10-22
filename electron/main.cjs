const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { preferences, atomicWrite } = require('./storage.cjs');
const translations = require('../locales.json');
const t = (key, values = {}) => (translations[prefs.language]?.[key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
const localizeMenu = entries => entries.map(entry => ({ ...entry, ...(entry.label ? { label: t(entry.label) } : {}), ...(entry.submenu ? { submenu: localizeMenu(entry.submenu) } : {}) }));

app.setName('Markdoc');
if (process.env.MARKDOC_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.MARKDOC_TEST_USER_DATA));
const ROOT = path.resolve(__dirname, '..');
let window, settingsPath, recoveryPath;
let prefs = preferences();
let document = { text: '', path: null, savedText: '' };
let queue = Promise.resolve(), settingsQueue = Promise.resolve();
let busy = false, closing = false;
const printWindows = new Set();
const dirty = () => document.text !== document.savedText;
const notify = message => window?.webContents.send('status:update', message);
const snapshot = () => ({ text: document.text, path: document.path, baseURL: pathToFileURL((document.path ? path.dirname(document.path) : ROOT) + path.sep).href, dirty: dirty(), preferences: prefs });
const title = () => window?.setTitle(`${dirty() ? '• ' : ''}${document.path ? path.basename(document.path) : t('새 문서')} — Markdoc`);

function persist() {
  const serialized = JSON.stringify(prefs, null, 2);
  settingsQueue = settingsQueue.catch(() => {}).then(() => atomicWrite(settingsPath, serialized));
  return settingsQueue;
}
function enqueue(task) {
  const next = queue.then(async () => {
    busy = true;
    try { return await task(); } finally { busy = false; }
  });
  queue = next.catch(error => { notify(t('오류: {message}', { message: error.message })); dialog.showErrorBox('Markdoc', error.message); });
  return next;
}
function remember(file) {
  prefs.recent = [file, ...prefs.recent.filter(item => item !== file)].slice(0, 10);
  buildMenu();
  return persist();
}
async function save(as = false, automatic = false) {
  let target = document.path;
  if (as || !target) {
    const result = await dialog.showSaveDialog(window, { title: t('Markdown 저장'), defaultPath: target || 'Untitled.md', filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (result.canceled) return false;
    target = result.filePath;
  }
  const text = document.text;
  await atomicWrite(target, text);
  document.path = target; document.savedText = text;
  await remember(target);
  await fs.rm(recoveryPath, { force: true });
  title();
  window.webContents.send('document:load', { ...snapshot(), metadataOnly: true });
  notify(t(automatic ? '자동 저장 완료: {path}' : '저장 완료: {path}', { path: target }));
  return true;
}
async function confirmChanges() {
  if (!dirty()) return true;
  const { response } = await dialog.showMessageBox(window, { type: 'question', title: t('변경 내용'), message: t('변경 내용을 저장할까요?'), buttons: ['저장', '저장하지 않음', '취소'].map(key => t(key)), defaultId: 0, cancelId: 2 });
  if (response === 2) return false;
  return response === 0 ? save() : true;
}
async function open(file) {
  if (!await confirmChanges()) return;
  if (!file) {
    const result = await dialog.showOpenDialog(window, { title: t('열기…'), properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return;
    file = result.filePaths[0];
  }
  if (!/\.md$/i.test(file)) throw new Error(t('.md 파일만 편집기에서 열 수 있습니다.'));
  const text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  document = { text, path: path.resolve(file), savedText: text };
  await remember(document.path);
  window.webContents.send('document:load', snapshot()); title(); notify(document.path);
}
function updatePreference(name, value) {
  prefs = preferences({ ...prefs, [name]: value });
  window.webContents.send('preferences:update', prefs); buildMenu();
  title();
  for (const printWindow of printWindows) if (printWindow.markdocPrint) configurePrintMenu(printWindow);
  persist().catch(error => notify(t('설정 저장 실패: {message}', { message: error.message })));
}
function buildMenu() {
  const command = name => () => window.webContents.send('editor:command', { name });
  const action = task => () => { enqueue(task).catch(() => {}); };
  Menu.setApplicationMenu(Menu.buildFromTemplate(localizeMenu([
    { label: '파일', submenu: [
      { label: '새 문서', accelerator: 'CmdOrCtrl+N', click: action(async () => {
        if (!await confirmChanges()) return;
        document = { text: '', path: null, savedText: '' };
        await fs.rm(recoveryPath, { force: true });
        window.webContents.send('document:load', snapshot()); title();
      }) },
      { label: '열기…', accelerator: 'CmdOrCtrl+O', click: action(() => open()) },
      { label: '저장', accelerator: 'CmdOrCtrl+S', click: action(() => save()) },
      { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: action(() => save(true)) },
      { label: '최근 연 파일', submenu: prefs.recent.length ? prefs.recent.map(file => ({ label: file, click: action(() => open(file)) })) : [{ label: '최근 파일 없음', enabled: false }] },
      { type: 'separator' },
      { label: 'PDF로 저장…', click: command('pdf') },
      { label: '인쇄 미리보기', click: command('preview-print') },
      { label: '인쇄…', accelerator: 'CmdOrCtrl+P', click: command('print') },
      { label: '인쇄 용지', submenu: ['A4', 'Letter'].map(paper => ({ label: paper, type: 'radio', checked: prefs.paper === paper, click: () => updatePreference('paper', paper) })) },
      { type: 'separator' }, { label: '종료', click: () => window.close() },
    ] },
    { label: '편집', submenu: [
      { label: '실행 취소', accelerator: 'CmdOrCtrl+Z', click: command('undo') },
      { label: '다시 실행', accelerator: 'CmdOrCtrl+Y', click: command('redo') },
      { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' },
      { type: 'separator' },
      ...[['볼드', 'bold'], ['이탤릭', 'italic'], ['취소선', 'strike'], ['밑줄', 'underline'], ['인라인 코드', 'code'], ['이미지 삽입…', 'image']].map(([label, name]) => ({ label, click: command(name) })),
    ] },
    { label: '설정', submenu: [
      { label: '다크 모드', type: 'checkbox', checked: prefs.dark, click: item => updatePreference('dark', item.checked) },
      { label: '자동 저장 (30초)', type: 'checkbox', checked: prefs.autosave, click: item => updatePreference('autosave', item.checked) },
      { label: '파일 탐색기', type: 'checkbox', checked: prefs.explorerVisible, click: item => updatePreference('explorerVisible', item.checked) },
      { label: '글자 크기 및 행간…', click: command('typography') },
      { label: '언어', submenu: [{ label: '한국어', type: 'radio', checked: prefs.language === 'ko', click: () => updatePreference('language', 'ko') }, { label: 'English', type: 'radio', checked: prefs.language === 'en', click: () => updatePreference('language', 'en') }] },
    ] },
  ])));
}
function configurePrintMenu(target) {
  target.setTitle(`${t('인쇄 미리보기')} — ${prefs.paper}`);
  target.setMenu(Menu.buildFromTemplate(localizeMenu([{ label: '파일', submenu: [{ label: '인쇄…', accelerator: 'CmdOrCtrl+P', click: () => target.markdocPrint().catch(error => dialog.showErrorBox(t('인쇄 실패'), error.message)) }, { label: '닫기', click: () => target.close() }] }])));
}
function secureWindow(target) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
async function printDocument(mode, markup) {
  if (typeof markup !== 'string' || markup.length > 25_000_000) throw new Error(t('인쇄 문서가 너무 큽니다.'));
  let target;
  if (mode === 'pdf') {
    const result = await dialog.showSaveDialog(window, { defaultPath: `${document.path ? path.basename(document.path, path.extname(document.path)) : 'Untitled'}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled) return;
    target = result.filePath;
  }
  const fontURL = name => pathToFileURL(path.join(ROOT, 'data', 'fonts', name)).href;
  const css = await fs.readFile(path.join(ROOT, 'dist', 'print.css'), 'utf8');
  const page = `<!doctype html><html lang="${prefs.language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src file:; img-src file: https: data:; script-src 'none'; object-src 'none'; base-uri 'none'"><title>Markdoc ${t('인쇄 미리보기')}</title><style>
    @font-face{font-family:PrintFace;src:url('${fontURL('Pretendard-Medium.otf')}');font-weight:400}
    @font-face{font-family:PrintFace;src:url('${fontURL('Pretendard-Bold.otf')}');font-weight:700}
    @font-face{font-family:CodeFace;src:url('${fontURL('D2Coding-Ver1.4.0-20261003.ttf')}');font-weight:400;font-style:normal}
    ${css} ${typographyCSS(prefs.typography)} @page{size:${prefs.paper};margin:20mm}
  </style></head><body><article class="markdown-body">${markup}</article></body></html>`;
  const temporary = path.join(app.getPath('userData'), `print-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  await fs.writeFile(temporary, page, 'utf8');
  const printWindow = new BrowserWindow({ show: false, width: 960, height: 850, title: `${t('인쇄 미리보기')} — ${prefs.paper}`, icon: path.join(ROOT, 'data', 'icon.ico'), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  printWindows.add(printWindow); secureWindow(printWindow);
  printWindow.on('closed', () => { printWindows.delete(printWindow); fs.rm(temporary, { force: true }).catch(() => {}); });
  const options = { printBackground: true, pageSize: prefs.paper };
  const print = () => new Promise((resolve, reject) => printWindow.webContents.print(options, (success, reason) => success || /cancel/i.test(reason) ? resolve() : reject(new Error(reason))));
  try {
    await printWindow.loadFile(temporary);
    await printWindow.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = image.onerror = resolve; setTimeout(resolve, 8000); }))])`);
    if (mode === 'pdf') {
      await fs.writeFile(target, await printWindow.webContents.printToPDF({ ...options, preferCSSPageSize: true }));
      notify(t('PDF 저장 완료: {path}', { path: target })); printWindow.destroy();
    } else if (mode === 'preview-print') {
      printWindow.markdocPrint = print;
      configurePrintMenu(printWindow);
      if (!process.env.MARKDOC_TEST_HIDDEN) printWindow.show();
    } else { await print(); printWindow.destroy(); }
  } catch (error) { printWindow.destroy(); throw error; }
}
function isMain(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}
function typographyCSS(type) {
  return `.markdown-body{font-size:${type.body}pt;line-height:${type.lineHeight}}` +
    [1, 2, 3, 4, 5, 6].map(level => `.markdown-body h${level}{font-size:${type['h' + level]}pt;line-height:${type.lineHeight}}`).join('');
}
async function explorerPath(candidate) {
  const root = await fs.realpath(prefs.explorerRoot || (app.isPackaged ? app.getPath('documents') : ROOT));
  const target = await fs.realpath(candidate || root);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(t('선택한 탐색기 폴더 밖에는 접근할 수 없습니다.'));
  return target;
}
ipcMain.handle('document:initial', event => {
  if (!isMain(event)) throw new Error(t('잘못된 요청입니다.'));
  return snapshot();
});
ipcMain.on('document:changed', (event, text) => {
  if (!isMain(event) || typeof text !== 'string') return;
  document.text = text; title();
});
ipcMain.on('document:autosave', (event, text) => {
  if (!isMain(event) || typeof text !== 'string' || !prefs.autosave || busy) return;
  document.text = text;
  if (!dirty()) return;
  enqueue(async () => {
    if (!dirty()) return;
    if (document.path) await save(false, true);
    else { await atomicWrite(recoveryPath, document.text); notify(t('새 문서 복구 사본 자동 저장됨 · 원본 저장: Ctrl+S')); }
  }).catch(() => {});
});
ipcMain.handle('document:action', (event, name, payload) => {
  if (!isMain(event)) throw new Error(t('잘못된 요청입니다.'));
  if (name === 'list-directory') return (async () => {
    const target = await explorerPath(typeof payload?.path === 'string' ? payload.path : null);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return { path: target, entries: entries.filter(item => !item.isSymbolicLink()).map(item => ({ name: item.name, path: path.join(target, item.name), directory: item.isDirectory(), markdown: item.isFile() && /\.md$/i.test(item.name) })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'ko')) };
  })();
  if (name === 'set-preferences') {
    if (payload?.paper) prefs.paper = payload.paper;
    if (payload?.typography) prefs.typography = payload.typography;
    if (typeof payload?.explorerVisible === 'boolean') prefs.explorerVisible = payload.explorerVisible;
    if (payload?.language) prefs.language = payload.language;
    prefs = preferences(prefs);
    window.webContents.send('preferences:update', prefs); buildMenu(); title();
    for (const printWindow of printWindows) if (printWindow.markdocPrint) configurePrintMenu(printWindow);
    return persist();
  }
  return enqueue(async () => {
    if (name === 'choose-folder') {
      const result = await dialog.showOpenDialog(window, { title: t('폴더 열기'), properties: ['openDirectory'] });
      if (result.canceled) return null;
      prefs.explorerRoot = await fs.realpath(result.filePaths[0]); await persist();
      return prefs.explorerRoot;
    }
    if (name === 'open-explorer-file') {
      if (typeof payload?.path !== 'string') throw new Error(t('파일 경로가 없습니다.'));
      const file = await explorerPath(payload.path);
      if (!/\.md$/i.test(file)) throw new Error(t('.md 파일만 열 수 있습니다.'));
      return open(file);
    }
    if (['pdf', 'preview-print', 'print'].includes(name)) return printDocument(name, payload?.html);
    if (name === 'relative-image') {
      if (!document.path) throw new Error(t('상대경로를 사용하려면 먼저 문서를 저장하세요.'));
      const relative = typeof payload?.path === 'string' ? payload.path.trim().replaceAll('\\', '/') : '';
      if (!relative || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(relative)) throw new Error(t('문서 위치를 기준으로 상대경로를 입력하세요.'));
      const file = path.resolve(path.dirname(document.path), relative), image = nativeImage.createFromPath(file);
      if (image.isEmpty()) throw new Error(t('이 이미지를 읽을 수 없습니다. PNG/JPEG/GIF/BMP/WebP/ICO를 선택하세요.'));
      return { src: pathToFileURL(file).href, markdownSrc: relative, ...image.getSize() };
    }
    if (name === 'pick-image') {
      const result = await dialog.showOpenDialog(window, { title: t('이미지 삽입'), properties: ['openFile'], filters: [{ name: t('이미지'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico'] }] });
      if (result.canceled) return null;
      const file = result.filePaths[0], image = nativeImage.createFromPath(file);
      if (image.isEmpty()) throw new Error(t('이 이미지를 읽을 수 없습니다. PNG/JPEG/GIF/BMP/WebP/ICO를 선택하세요.'));
      return { src: pathToFileURL(file).href, ...image.getSize() };
    }
    throw new Error(t('지원하지 않는 명령입니다.'));
  });
});
async function createWindow() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  recoveryPath = path.join(app.getPath('userData'), 'unsaved-recovery.md');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  try { prefs = preferences(JSON.parse(await fs.readFile(settingsPath, 'utf8'))); } catch { /* first run */ }
  window = new BrowserWindow({ width: 1100, height: 800, minWidth: 560, minHeight: 360, backgroundColor: prefs.dark ? '#121212' : '#F5F5F5', icon: path.join(ROOT, 'data', 'icon.ico'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false } });
  secureWindow(window); buildMenu(); title();
  window.once('ready-to-show', () => { if (!process.env.MARKDOC_TEST_HIDDEN) window.show(); });
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    enqueue(async () => {
      if (!await confirmChanges()) return;
      await persist(); await fs.rm(recoveryPath, { force: true });
      for (const printWindow of printWindows) printWindow.destroy();
      closing = true; window.destroy(); app.quit();
    }).catch(() => {});
  });
  await window.loadFile(path.join(ROOT, 'dist', 'index.html'));
  try {
    const recovery = await fs.readFile(recoveryPath, 'utf8');
    const { response } = await dialog.showMessageBox(window, { message: t('저장하지 않은 문서의 자동 저장 사본을 복구할까요?'), buttons: ['복구', '건너뛰기'].map(key => t(key)), defaultId: 0, cancelId: 1 });
    if (response === 0) { document = { text: recovery, path: null, savedText: '' }; window.webContents.send('document:load', snapshot()); title(); }
  } catch { /* no recovery */ }
  const input = process.argv.slice(app.isPackaged ? 1 : 2).find(arg => /\.(md|markdown)$/i.test(arg));
  if (input) await open(path.resolve(input));
}
app.whenReady().then(createWindow).catch(error => { dialog.showErrorBox(t('Markdoc 시작 실패'), error.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
