const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

test('toolbar dropdowns preserve selection and toggle code; theme icons load', { timeout: 45000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-toolbar-'));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: folder, MARKDOC_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
  app.process().stdout.on('data', () => {}); app.process().stderr.on('data', () => {});
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const page = await app.firstWindow(); await page.waitForSelector('.tiptap');
  await page.locator('.tiptap').fill('Toolbar test');
  await page.selectOption('#heading', 'h2'); await expect(page.locator('.tiptap h2')).toHaveText('Toolbar test');
  await page.selectOption('#heading', 'paragraph'); await expect(page.locator('.tiptap p').first()).toHaveText('Toolbar test');
  await page.selectOption('#code-style', 'codeblock'); await expect(page.locator('.tiptap pre')).toHaveText('Toolbar test');
  await page.selectOption('#code-style', 'codeblock'); await expect(page.locator('.tiptap pre')).toHaveCount(0);
  await page.selectOption('#code-style', 'code'); await page.keyboard.insertText('inline'); await expect(page.locator('.tiptap p code')).toHaveText('inline');
  for (const dark of [false, true]) {
   if (dark) await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '설정').submenu.items.find(item => item.label === '다크 모드').click());
   await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
   const icons = page.locator('#toolbar img:visible'); await expect(icons).toHaveCount(17);
   await expect.poll(() => icons.evaluateAll(nodes => nodes.every(n => n.complete && n.naturalWidth > 0))).toBe(true);
   assert.ok((await icons.evaluateAll(nodes => nodes.map(n => n.className))).every(name => name.includes(dark ? 'icon-dark' : 'icon-light')));
  }
  assert.deepEqual(await page.locator('#toolbar>button').evaluateAll(nodes => nodes.slice(0, 5).map(n => n.dataset.action || n.dataset.icon)), ['explorer', 'save', 'settings', 'undo', 'redo']);
  await page.selectOption('#paper', 'none');
  assert.equal(await page.locator('#document-surface').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(36, 36, 36)');
 } finally {
  if (app) await app.close();
  await fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
 }
});
