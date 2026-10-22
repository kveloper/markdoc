const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');

test('front matter displays as code and survives editing and Markdown save', { timeout: 30000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-frontmatter-'));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: folder, MARKDOC_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  const metadata = '---\ntitle: "ABOUT"\nsubtitle: "KVELOPER 소개"\ncategory: "NOTICE"\nimage: /assets/images/kv_alter.png\n---';
  const file = path.join(folder, 'metadata.md'), saved = path.join(folder, 'saved.md');
  await fs.writeFile(file, metadata + '\n\n# Body\n\nText\n\n---\n\n```yaml\ntitle: ordinary code\n```');
  app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
  app.process().stdout.on('data', () => {}); app.process().stderr.on('data', () => {});
  const menu = async label => app.evaluate(({ Menu }, label) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === label).click(), label);
  await app.evaluate(({ dialog }, file) => {
   dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
   dialog.showMessageBox = async () => ({ response: 1 });
  }, file);
  const page = await app.firstWindow(); await page.waitForSelector('.tiptap');
  await menu('열기…');
  await expect(page.locator('.tiptap pre[data-frontmatter="true"]')).toHaveText(metadata);
  await expect(page.locator('.tiptap h1')).toHaveText('Body');
  await expect(page.locator('.tiptap hr')).toHaveCount(1);
  assert.equal(await page.locator('.tiptap pre[data-frontmatter] code').evaluate(node => getComputedStyle(node).fontFamily), 'CodeFace, monospace');
  await page.locator('.tiptap pre[data-frontmatter] code').click();
  await page.keyboard.press('ArrowRight'); await page.keyboard.type('X'); await page.keyboard.press('Backspace');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
  await menu('다른 이름으로 저장…');
  await expect.poll(() => fs.readFile(saved, 'utf8').catch(() => '')).toContain(metadata);
  const result = await fs.readFile(saved, 'utf8');
  assert.ok(result.startsWith(metadata));
  assert.match(result, /```yaml\ntitle: ordinary code\n```/);
 } finally { if (app) await app.close(); await fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
