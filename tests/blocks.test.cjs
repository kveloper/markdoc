const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');

test('code and quote decorations stop at page margins; code uses embedded D2Coding', { timeout: 30000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-blocks-'));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: folder, MARKDOC_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
  app.process().stdout.on('data', () => {}); app.process().stderr.on('data', () => {});
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); dialog.showErrorBox = () => {}; });
  const page = await app.firstWindow(); await page.waitForSelector('.tiptap');
  const open = async text => {
   const file = path.join(folder, 'blocks.md'); await fs.writeFile(file, text);
   await app.evaluate(({ dialog, Menu }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '열기…').click(); }, file);
   await page.waitForSelector(text.startsWith('```') ? '.tiptap pre' : '.tiptap blockquote');
   await page.waitForSelector('.page-margin-mask'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200);
  };
  const sample = async (selector, dark = false) => {
   const png = await page.locator('.page-margin-mask').first().screenshot({ scale: 'css' });
   const points = await page.evaluate(selector => {
    const mask = document.querySelector('.page-margin-mask').getBoundingClientRect();
    const block = document.querySelector(selector).getBoundingClientRect();
    const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-margin'));
    return [margin / 2, margin + 12, margin + 24 + margin / 2].map(y => ({ x: Math.floor(block.left - mask.left + 1), y: Math.floor(y) }));
   }, selector);
   for (const [index, point] of points.entries()) {
    const pixel = await app.evaluate(({ nativeImage }, { base64, point }) => {
     const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
     const offset = (point.y * image.getSize().width + point.x) * 4;
     return Array.from(image.getBitmap().subarray(offset, offset + 3)).reverse();
    }, { base64: png.toString('base64'), point });
    assert.deepEqual(pixel, index === 1 ? (dark ? [18, 18, 18] : [229, 231, 235]) : [255, 255, 255], `${selector}: page margin / gap color`);
   }
  };
  const code = '```python\n' + Array.from({ length: 130 }, (_, i) => `print("line ${i} / 한글")`).join('\n') + '\n```\n\nAfter the code block.';
  await open(code);
  assert.equal(await page.locator('.tiptap pre code').evaluate(node => getComputedStyle(node).fontFamily), 'CodeFace, monospace');
  assert.ok(await page.evaluate(() => document.fonts.check('16px CodeFace')));
  const hiddenCodeLines = await page.evaluate(() => {
   const root = document.querySelector('.tiptap'), origin = root.getBoundingClientRect().top;
   const css = getComputedStyle(document.documentElement), height = parseFloat(css.getPropertyValue('--page-height')), margin = parseFloat(css.getPropertyValue('--page-margin'));
   const walker = document.createTreeWalker(document.querySelector('.tiptap pre'), NodeFilter.SHOW_TEXT), overflow = [];
   let node;
   while ((node = walker.nextNode())) {
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
     if (rect.width < .5) continue;
     let y = (rect.top - origin) % (height + 24); if (y > height + 23) y = 0;
     if (y + rect.height > height - 2 * margin + 1) overflow.push({ y, height: rect.height });
    }
   }
   return overflow;
  });
  assert.deepEqual(hiddenCodeLines, [], 'Page masks must not hide any code text');
  await sample('.tiptap pre');
  const pdf = path.join(folder, 'code.pdf');
  await app.evaluate(({ dialog, Menu }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'PDF로 저장…').click(); }, pdf);
  await expect.poll(async () => fs.readFile(pdf).then(buffer => buffer.toString('latin1')).catch(() => ''), { timeout: 15000 }).toContain('D2Coding');
  await open(Array.from({ length: 75 }, (_, i) => `> Quote ${i} / 인용문 테스트\n>`).join('\n') + '\n\nAfter the quote.');
  await sample('.tiptap blockquote');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '설정').submenu.items.find(item => item.label === '다크 모드').click());
  await sample('.tiptap blockquote', true);
 } finally { if (app) await app.close(); await fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
