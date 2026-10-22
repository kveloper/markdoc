const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');

test('folder emoji and live Korean/English UI switching preserve the document and persist', { timeout: 30000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-i18n-'));
 const root = path.join(folder, 'files'); await fs.mkdir(path.join(root, '한글 폴더'), { recursive: true });
 await fs.writeFile(path.join(root, '한글 폴더', '문서.md'), '# 파일 이름 유지');
 const userData = path.join(folder, 'settings'); await fs.mkdir(userData);
 await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ explorerRoot: root }));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: userData, MARKDOC_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 const launch = async () => {
  app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
  app.process().stdout.on('data', () => {}); app.process().stderr.on('data', () => {});
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); dialog.showErrorBox = () => {}; });
  const page = await app.firstWindow(); await page.waitForSelector('.tiptap'); return page;
 };
 const language = async label => app.evaluate(({ Menu }, label) => {
  const settings = Menu.getApplicationMenu().items.find(item => ['설정', 'Settings'].includes(item.label));
  const languages = settings.submenu.items.find(item => ['언어', 'Language'].includes(item.label));
  languages.submenu.items.find(item => item.label === label).click();
 }, label);
 try {
  let page = await launch();
  await expect(page.locator('.directory-name')).toHaveText('📁 한글 폴더');
  await expect(page.locator('#folder-name')).toHaveText('📁 files');
  await page.locator('.directory-name').click();
  await expect(page.locator('.file-name')).toHaveText('문서.md');
  await page.locator('.tiptap').click(); await page.keyboard.insertText('한글 English 문서');
  const before = await page.evaluate(() => window.markdoc.initial());
  await language('English');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-action="explorer"]')).toHaveText('File Explorer');
  await expect(page.locator('#choose-folder')).toHaveText('Open Folder');
  await expect(page.locator('#statistics')).toContainText('Characters');
  await expect(page.locator('#statistics')).toContainText('Words');
  await expect(page.locator('[data-action="image"]')).toHaveAttribute('aria-label', 'Insert Image');
  await expect(page.locator('.directory-name')).toHaveText('📁 한글 폴더');
  await expect(page.locator('.file-name')).toHaveText('문서.md');
  const after = await page.evaluate(() => window.markdoc.initial());
  assert.equal(after.text, before.text); assert.equal(after.dirty, before.dirty);
  assert.deepEqual(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label)), ['File', 'Edit', 'Settings']);
  await page.locator('[data-action="typography"]').click();
  await expect(page.locator('#typography-dialog h2')).toHaveText('Font Sizes and Line Spacing');
  await expect(page.locator('#typography-fields label').first()).toContainText('Body');
  await language('한국어');
  await expect(page.locator('#typography-dialog h2')).toHaveText('글자 크기 및 행간');
  await expect(page.locator('#typography-fields label').first()).toContainText('본문');
  await page.locator('#typography-dialog button[value="cancel"]').click();
  await expect(page.locator('#statistics')).toContainText('공백 포함');
  await language('English');
  await page.locator('[data-action="table"]').click();
  await expect(page.locator('#table-dialog h2')).toHaveText('Insert Table');
  await expect(page.locator('#table-dialog button[value="insert"]')).toHaveText('Insert');
  await page.locator('#table-dialog button[value="cancel"]').click();
  await app.close(); app = null;
  assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8')).language, 'en');
  page = await launch();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#refresh-files')).toHaveText('Refresh');
  assert.ok((await app.firstWindow()).url().includes('index.html'));
 } finally { if (app) await app.close(); await fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
