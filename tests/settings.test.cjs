const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

test('save/settings popups, automatic arrows, localization and continuous dark paper', { timeout: 45000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-settings-'));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: folder, MARKDOC_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
  app.process().stdout.on('data', () => {}); app.process().stderr.on('data', () => {});
  await app.evaluate(({ dialog, Menu }) => {
   dialog.showMessageBox = async () => ({ response: 1 });
  });
  const page = await app.firstWindow(); await page.waitForSelector('.tiptap');
  await expect(page.locator('#menubar')).toHaveCount(0);
  await app.evaluate(({ Menu }) => { for (const index of [0, 2]) Menu.getApplicationMenu().items[index].submenu.popup = () => { global.popupIndex = index; }; });
  for (const index of [0, 2]) {
   await page.locator(`[data-menu="${index}"]`).click();
   await expect.poll(() => app.evaluate(() => global.popupIndex)).toBe(index);
  }
  const text = page.locator('.tiptap');
  const clear = async () => { await text.click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await expect(text).toHaveText(''); };
  await text.click(); await page.keyboard.type('a->b');
  await expect(text).toHaveText('a→b');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  // Start a fresh plain paragraph before checking disabled conversion.
  await clear(); await expect(text).toHaveText('');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[2].submenu.items.find(item => item.label.startsWith('화살표')).click());
  await expect.poll(async () => (await page.evaluate(() => window.markdoc.initial())).preferences.autoArrow).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('data-auto-arrow', 'false');
  await page.keyboard.type('a-'); await expect(text).toHaveText('a-');
  await page.keyboard.type('>b'); await expect(text).toHaveText('a->b');
  assert.equal((await page.evaluate(() => window.markdoc.initial())).preferences.autoArrow, false);
  await page.evaluate(() => window.markdoc.action('set-preferences', { autoArrow: true }));
  await expect(page.locator('html')).toHaveAttribute('data-auto-arrow', 'true');
  await clear(); await page.selectOption('#code-style', 'codeblock');
  await page.keyboard.type('a->b'); await expect(page.locator('.tiptap pre')).toHaveText('a->b');
  await page.selectOption('#code-style', 'codeblock'); await clear();
  await page.keyboard.type('->'); await expect(text).toHaveText('→');
  await page.keyboard.press('Backspace'); await expect(text).toHaveText('->');
  await page.selectOption('#paper', 'none');
  await page.evaluate(() => window.markdoc.action('set-preferences', { dark: true, language: 'en' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(await page.locator('#document-surface').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(36, 36, 36)');
  assert.equal(await text.evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
  await expect(page.locator('#heading option').first()).toHaveText('Body');
  await expect(page.locator('#paper option[value="none"]')).toHaveText('No paper');
  await expect(page.locator('#code-style option[value="codeblock"]')).toHaveText('Code Block');
  const untranslated = await page.evaluate(() => {
   const issues = [];
   for (const root of document.querySelectorAll('#toolbar,.explorer-actions,dialog')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) if (/[가-힣]/.test(node.textContent)) issues.push(node.textContent);
    for (const node of root.querySelectorAll('[aria-label],[title]')) for (const key of ['aria-label', 'title']) if (/[가-힣]/.test(node.getAttribute(key) || '')) issues.push(node.getAttribute(key));
   }
   return issues;
  });
  assert.deepEqual(untranslated, []);
  const settings = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[2].submenu.items.map(item => item.label));
  assert.deepEqual(settings, ['Dark Mode', 'Autosave (30 seconds)', 'Automatic arrows (-> →)', 'Language']);
  const file = path.join(folder, 'saved.md');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
  // Save remains available through its accelerator despite the hidden native menu.
  const savedText = (await page.evaluate(() => window.markdoc.initial())).text;
  await page.keyboard.press('Control+s');
  await expect.poll(async () => { try { return await fs.readFile(file, 'utf8'); } catch { return null; } }).toBe(savedText);
  await page.evaluate(() => window.markdoc.action('set-preferences', { language: 'ko', autoArrow: false }));
  await expect(page.locator('#heading option').first()).toHaveText('본문');
  await expect(page.locator('#code-style option[value="codeblock"]')).toHaveText('코드 블록');
  await expect(page.locator('#paper option[value="none"]')).toHaveText('용지 없음');
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(folder, 'settings.json'), 'utf8')).autoArrow).toBe(false);
 } finally {
  if (app) await app.close();
  await fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
 }
});
