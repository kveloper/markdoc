import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { EditorState } from '@tiptap/pm/state';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { renderMarkdown } from './markdown';
import { createPagination, paperMetrics, PAGE_GAP } from './pagination';
import { resizableImage } from './image';
import { MathFormula, setupMathDialog, renderFormula } from './math';
import './style.css';
import translations from '../locales.json';

const api = window.markdoc;
let prefs = { language: 'ko', paper: 'A4', autosave: true, explorerVisible: true, typography: { body: 12, h1: 26, h2: 22, h3: 19, h4: 17, h5: 15, h6: 13, lineHeight: 1.7 } };
const t = (key, values = {}) => (translations[prefs.language]?.[key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
const uiText = [], uiAttributes = [];
for (const region of document.querySelectorAll('#menubar,#toolbar,#explorer,#typography-dialog,#table-dialog,#link-dialog,#image-dialog,#math-dialog')) {
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const key = node.textContent.trim();
    if (translations.en[key]) uiText.push({ node, key, before: node.textContent.match(/^\s*/)[0], after: node.textContent.match(/\s*$/)[0] });
  }
}
for (const node of document.querySelectorAll('[aria-label],[title]')) for (const attribute of ['aria-label', 'title']) {
  const key = node.getAttribute(attribute);
  if (translations.en[key]) uiAttributes.push({ node, attribute, key });
}
function translateUI() {
  document.documentElement.lang = prefs.language;
  for (const item of uiText) if (item.node.isConnected) item.node.textContent = item.before + t(item.key) + item.after;
  for (const item of uiAttributes) item.node.setAttribute(item.attribute, t(item.key));
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  editor.view.dom.setAttribute('aria-label', t('위지윅 문서'));
  editor.view.dom.dispatchEvent(new Event('ui-language'));
}
let baseURL = new URL('../', location.href).href;
let loading = false, received = false, hasEdits = false, pageCount = 1, explorerRoot, currentPath;
const status = document.querySelector('#status');
for (const button of document.querySelectorAll('[data-menu]')) {
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect();
    api.action('show-menu', { index: Number(button.dataset.menu), x: Math.round(rect.left), y: Math.round(rect.bottom) });
  });
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = (Number(button.dataset.menu) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    document.querySelector(`[data-menu="${index}"]`).focus();
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'F10' && !event.shiftKey) {
    event.preventDefault(); document.querySelector('[data-menu="0"]').focus();
  }
});
const surface = document.querySelector('#document-surface');
const sheets = document.querySelector('#page-sheets');
const pageMasks = document.querySelector('#page-masks');
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '*', bulletListMarker: '-' });
turndown.use(gfm);
turndown.addRule('math-formula', {
  filter: node => node.getAttribute('data-type') === 'mathFormula',
  replacement: (_content, node) => node.getAttribute('data-display') === 'false' ? `$${node.getAttribute('data-tex')}$` : `\n\n$$\n${node.getAttribute('data-tex')}\n$$\n\n`,
});
turndown.addRule('front-matter', {
  filter: node => node.nodeName === 'PRE' && node.getAttribute('data-frontmatter') === 'true',
  replacement: (_content, node) => `\n\n${node.textContent}\n\n`,
});
turndown.addRule('underline', { filter: ['u', 'ins'], replacement: content => `<u>${content}</u>` });
turndown.addRule('image-dimensions', { filter: 'img', replacement: (_content, node) => {
  const escape = text => String(text || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return '\n\n<img ' + ['src', 'alt', 'title', 'width', 'height'].filter(key => node.hasAttribute(key)).map(key => `${key}="${escape(key === 'src' ? node.getAttribute('data-markdown-src') || node.getAttribute(key) : node.getAttribute(key))}"`).join(' ') + ' />\n\n';
} });
turndown.addRule('tasks', { filter: node => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem', replacement: (content, node) => `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim()}\n` });
const markdown = () => turndown.turndown(editor.getHTML());

function updateStatistics() {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '').replaceAll('\n', '');
  const characters = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)].length;
  const words = [...new Intl.Segmenter('ko', { granularity: 'word' }).segment(editor.getText())].filter(part => part.isWordLike).length;
  document.querySelector('#statistics').textContent = t('글자 {characters} (공백 포함) · 단어 {words} · {pages}쪽', { characters: characters.toLocaleString(), words: words.toLocaleString(), pages: pageCount.toLocaleString() });
}
function drawPages(count) {
  pageCount = count;
  const page = paperMetrics(prefs.paper);
  const height = count * page.height + (count - 1) * PAGE_GAP;
  surface.style.minHeight = `${height}px`;
  if (sheets.children.length !== count) sheets.replaceChildren(...Array.from({ length: count }, (_, index) => {
    const sheet = document.createElement('div'); sheet.className = 'page-sheet';
    const label = document.createElement('span'); label.className = 'page-number'; label.textContent = String(index + 1); sheet.append(label);
    return sheet;
  }));
  [...sheets.children].forEach((sheet, index) => { sheet.style.top = `${index * (page.height + PAGE_GAP)}px`; });
  // Paint only the non-content bands above the editor. A single logical quote
  // or code node can span pages without its border/background joining sheets.
  if (pageMasks.children.length !== count - 1) pageMasks.replaceChildren(...Array.from({ length: count - 1 }, () => {
    const mask = document.createElement('div'); mask.className = 'page-margin-mask'; return mask;
  }));
  [...pageMasks.children].forEach((mask, index) => {
    mask.style.top = `${(index + 1) * page.height + index * PAGE_GAP - page.margin}px`;
    mask.style.height = `${page.margin * 2 + PAGE_GAP}px`;
  });
  if (editor) updateStatistics();
}
const editor = new Editor({
  element: document.querySelector('#editor'),
  extensions: [
    MathFormula,
    StarterKit.configure({ link: { openOnClick: false } }),
    Extension.create({
      name: 'frontMatter',
      addGlobalAttributes() {
        return [{ types: ['codeBlock'], attributes: { frontMatter: {
          default: false,
          parseHTML: element => element.getAttribute('data-frontmatter') === 'true',
          renderHTML: attributes => attributes.frontMatter ? { 'data-frontmatter': 'true' } : {},
        } } }];
      },
    }),
    TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }),
    resizableImage(() => prefs.paper, t), createPagination(() => paperMetrics(prefs.paper), drawPages),
  ],
  content: '',
  editorProps: {
    attributes: { class: 'document-body', 'aria-label': '위지윅 문서', spellcheck: 'false' },
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain');
      if (!event.clipboardData?.getData('text/html') && text && (/^\uFEFF?---[ \t]*\r?\n/.test(text) || /(^#{1,6} |\*\*.+\*\*|^```|^\|.+\||^\$\$|\$[^$\n]+\$)/m.test(text))) {
        event.preventDefault(); editor.commands.insertContent(renderMarkdown(text, baseURL)); return true;
      }
      return false;
    },
    handleKeyDown(_view, event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.commands.redo(); return true; }
      return false;
    },
  },
  onUpdate() { if (!loading) { hasEdits = true; api.changed(markdown()); updateStatistics(); } },
  onSelectionUpdate() { updateToolbar(); },
});
const mathDialog = setupMathDialog(editor, modal, t);
setInterval(() => { if (prefs.autosave && hasEdits && !editor.view.composing) api.autosave(markdown()); }, 30000);

function paginate() { editor.view.dom.dispatchEvent(new Event('paginate')); }
function applyPreferences(next) {
  const languageChanged = prefs.language !== next.language;
  prefs = next;
  translateUI();
  if (languageChanged) status.textContent = currentPath || t('새 문서 · Ctrl+S로 저장');
  document.documentElement.dataset.theme = next.dark ? 'dark' : 'light';
  document.querySelector('#explorer').hidden = !next.explorerVisible;
  document.querySelector('#paper').value = next.paper;
  const page = paperMetrics(next.paper);
  for (const [name, value] of Object.entries({ 'page-width': page.width, 'page-height': page.height, 'page-margin': page.margin })) document.documentElement.style.setProperty('--' + name, `${value}px`);
  for (const [name, value] of Object.entries(next.typography)) document.documentElement.style.setProperty('--' + name, name === 'lineHeight' ? String(value) : `${value}pt`);
  drawPages(pageCount); editor.view.dom.dispatchEvent(new Event('page-metrics')); paginate();
}
async function loadDocument(data) {
  currentPath = data.path;
  baseURL = data.baseURL || baseURL;
  if (!data.metadataOnly) {
    hasEdits = false;
    loading = true;
    // Recreate state to avoid undoing into a different file.
    editor.commands.setContent(renderMarkdown(data.text, baseURL), { emitUpdate: false });
    const fresh = EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins });
    editor.view.updateState(fresh);
    loading = false;
    editor.commands.focus('start');
  }
  if (data.metadataOnly) hasEdits = data.dirty;
  applyPreferences(data.preferences); updateStatistics(); updateToolbar();
  status.textContent = data.path || t('새 문서 · Ctrl+S로 저장');
}
function updateToolbar() {
  document.querySelector('#table-tools').hidden = !editor.isActive('table');
  for (const button of document.querySelectorAll('#toolbar [data-action]')) {
    const action = button.dataset.action;
    const active = /^h[1-6]$/.test(action) ? editor.isActive('heading', { level: Number(action[1]) }) : editor.isActive(action === 'codeblock' ? 'codeBlock' : action);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
async function modal(id) {
  const dialog = document.querySelector(id); dialog.returnValue = '';
  const result = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  dialog.showModal(); return result;
}
async function typographyDialog() {
  const fields = document.querySelector('#typography-fields'); fields.replaceChildren();
  for (const [key, title] of [['body', '본문'], ...[1, 2, 3, 4, 5, 6].map(level => ['h' + level, 'H' + level]), ['lineHeight', '행간 배수']]) {
    const label = document.createElement('label');
    const caption = document.createElement('span'); caption.dataset.i18n = title; caption.textContent = t(title); label.append(caption);
    const input = document.createElement('input'); input.name = key; input.type = 'number'; input.required = true;
    input.min = key === 'lineHeight' ? '1' : '8'; input.max = key === 'lineHeight' ? '3' : '72'; input.step = key === 'lineHeight' ? '0.1' : '1'; input.value = prefs.typography[key]; label.append(input); fields.append(label);
  }
  if (await modal('#typography-dialog') === 'apply') {
    const values = Object.fromEntries([...fields.querySelectorAll('input')].map(input => [input.name, Number(input.value)]));
    await api.action('set-preferences', { typography: values });
  }
}
async function command(name) {
  try {
    if (/^h[1-6]$/.test(name)) editor.chain().focus().toggleHeading({ level: Number(name[1]) }).run();
    else if (name === 'paragraph') editor.chain().focus().setParagraph().run();
    else if (['bold', 'italic', 'underline', 'strike', 'code'].includes(name)) editor.chain().focus().toggleMark(name).run();
    else if (name === 'codeblock') editor.chain().focus().toggleCodeBlock().run();
    else if (['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(name)) editor.chain().focus()[{ bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', taskList: 'toggleTaskList', blockquote: 'toggleBlockquote' }[name]]().run();
    else if (name === 'horizontalRule') editor.chain().focus().setHorizontalRule().run();
    else if (name === 'undo' || name === 'redo') editor.chain().focus()[name]().run();
    else if (['addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'deleteTable'].includes(name)) editor.chain().focus()[name]().run();
    else if (name === 'explorer') await api.action('set-preferences', { explorerVisible: !prefs.explorerVisible });
    else if (name === 'typography') await typographyDialog();
    else if (name === 'math') await mathDialog();
    else if (name === 'table') {
      if (await modal('#table-dialog') === 'insert') editor.chain().focus().insertTable({ rows: Number(document.querySelector('#table-rows').value), cols: Number(document.querySelector('#table-cols').value), withHeaderRow: true }).run();
    } else if (name === 'image') {
      document.querySelector('#image-relative').value = '';
      const choice = await modal('#image-dialog');
      if (!['absolute', 'relative'].includes(choice)) return;
      const image = await api.action(choice === 'absolute' ? 'pick-image' : 'relative-image', { path: document.querySelector('#image-relative').value });
      if (image) {
        const page = paperMetrics(prefs.paper), ratio = image.width / image.height;
        const width = Math.min(image.width, page.width - page.margin * 2, (page.height - page.margin * 2 - 12) * ratio);
        editor.chain().focus().setImage({ src: image.src, markdownSrc: image.markdownSrc || null, width: Math.round(width), height: Math.round(width / ratio) }).run();
      }
    } else if (name === 'link') {
      document.querySelector('#link-url').value = editor.getAttributes('link').href || '';
      if (await modal('#link-dialog') === 'insert') editor.chain().focus().extendMarkRange('link').setLink({ href: document.querySelector('#link-url').value }).run();
    } else if (['pdf', 'print'].includes(name)) {
      const copy = editor.view.dom.cloneNode(true);
      for (const formula of copy.querySelectorAll('.math-formula')) {
        try { renderFormula(formula, formula.dataset.tex, formula.dataset.display !== 'false'); } catch { formula.textContent = formula.dataset.tex; }
      }
      copy.querySelectorAll('.page-break,.image-resize-handle').forEach(node => node.remove());
      await api.action(name, { html: copy.innerHTML });
    }
    updateToolbar();
  } catch (error) { status.textContent = t('오류: {message}', { message: error.message }); }
}
document.querySelector('#toolbar').addEventListener('mousedown', event => { if (event.target.closest('button[data-action]')) event.preventDefault(); });
document.querySelector('#toolbar').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) command(button.dataset.action); });
document.querySelector('#paper').addEventListener('change', event => api.action('set-preferences', { paper: event.target.value }));

async function listDirectory(target, container) {
  const result = await api.action('list-directory', target ? { path: target } : {});
  container.replaceChildren();
  for (const entry of result.entries) {
    const row = document.createElement('div'); row.className = 'tree-row';
    const button = document.createElement('button'); button.textContent = entry.directory ? `📁 ${entry.name}` : entry.name; button.title = entry.path;
    button.className = entry.directory ? 'directory-name' : 'file-name';
    button.disabled = !entry.directory && !entry.markdown;
    button.setAttribute('role', 'treeitem');
    if (entry.directory) {
      button.setAttribute('aria-expanded', 'false');
      const children = document.createElement('div'); children.className = 'tree-children'; children.hidden = true; children.setAttribute('role', 'group');
      button.addEventListener('click', async () => {
        try {
          if (children.hidden) { await listDirectory(entry.path, children); children.hidden = false; } else children.hidden = true;
          button.setAttribute('aria-expanded', String(!children.hidden));
        } catch (error) { status.textContent = error.message; }
      });
      row.append(button, children);
    } else {
      button.addEventListener('click', () => api.action('open-explorer-file', { path: entry.path }).catch(error => { status.textContent = error.message; }));
      row.append(button);
    }
    container.append(row);
  }
  return result.path;
}
async function refreshFiles(root = explorerRoot) {
  try {
    explorerRoot = await listDirectory(root, document.querySelector('#file-tree'));
    document.querySelector('#folder-name').textContent = `📁 ${explorerRoot.split(/[\\/]/).filter(Boolean).at(-1) || explorerRoot}`;
    document.querySelector('#folder-name').title = explorerRoot;
  } catch (error) { status.textContent = t('탐색기: {message}', { message: error.message }); }
}
document.querySelector('#choose-folder').addEventListener('click', async () => { const root = await api.action('choose-folder'); if (root) refreshFiles(root); });
document.querySelector('#refresh-files').addEventListener('click', () => refreshFiles());
api.onDocument(data => { received = true; loadDocument(data); });
api.onPreferences(applyPreferences); api.onStatus(message => { status.textContent = message; }); api.onCommand(({ name }) => command(name));
api.initial().then(data => { if (!received) loadDocument(data); refreshFiles(data.preferences.explorerRoot); });
document.fonts.ready.then(paginate);
