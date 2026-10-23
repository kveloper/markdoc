const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '..');

test('WYSIWYG pages, Markdown roundtrip, explorer, counts, typography, image resizing, tables and PDF', { timeout: 120000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-wysiwyg-'));
 const env = { ...process.env, MARKDOC_TEST_USER_DATA: path.join(folder,'settings'), MARKDOC_TEST_HIDDEN:'1' }; delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  await fs.mkdir(path.join(folder,'nested'));
  await fs.writeFile(path.join(folder,'notes.txt'),'not Markdown');
  await fs.writeFile(path.join(folder,'nested','nested.md'),'# Nested file\n\n안녕하세요 world');
  app = await _electron.launch({args:[ROOT],env}); app.process().stdout.on('data',()=>{});app.process().stderr.on('data',()=>{});
  await app.evaluate(({dialog})=>{dialog.showErrorBox=()=>{};});
  const page = await app.firstWindow(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('.tiptap');await page.evaluate(()=>document.fonts.ready);
  const click = action => page.locator(`[data-action="${action}"]`).click();
  const menu = (section,label) => app.evaluate(({Menu},[section,label])=>Menu.getApplicationMenu().items.find(i=>i.label===section).submenu.items.find(i=>i.label===label).click(),[section,label]);
  const open = async (text,name='fixture.md')=>{
   const file=path.join(folder,name);await fs.writeFile(file,text);
   await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},file);
   await menu('파일','열기…');await expect(page.locator('#status')).toContainText(name);
  };
  await open('# 제목 Heading\n\n**Bold** *italic* <u>밑줄</u> ~~삭제~~ `inline`\n\n```python\nprint("안녕")\n```');
  await expect(page.locator('.tiptap h1')).toHaveText('제목 Heading');await expect(page.locator('.tiptap strong')).toHaveText('Bold');
  assert.ok(!(await page.locator('.tiptap').innerText()).includes('**'));
  assert.equal(await page.locator('#preview-pane').count(),0);
  await open('');await page.locator('.tiptap').click();await page.keyboard.type('# ');await page.keyboard.insertText('입력한 제목');
  await expect(page.locator('.tiptap h1')).toHaveText('입력한 제목');
  await page.keyboard.press('Enter');await click('bold');await page.keyboard.insertText('굵은 글씨');await click('bold');
  await expect(page.locator('.tiptap strong')).toContainText('굵은 글씨');
  const state=await page.evaluate(()=>window.markdoc.initial());assert.ok(state.text.includes('**굵은 글씨**'));
  await open('안녕 world!');await expect(page.locator('#statistics')).toContainText('글자 9');await expect(page.locator('#statistics')).toContainText('단어 2');
  await click('explorer');await expect(page.locator('#explorer')).toBeHidden();await click('explorer');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
  await page.locator('#choose-folder').click();await expect(page.locator('.file-name').filter({hasText:'notes.txt'})).toBeDisabled();
  await page.locator('.directory-name').filter({hasText:'nested'}).click();await page.locator('.file-name').filter({hasText:'nested.md'}).click();
  await expect(page.locator('.tiptap h1')).toHaveText('Nested file');
  await assert.rejects(page.evaluate(file=>window.markdoc.action('open-explorer-file',{path:file}),path.join(folder,'notes.txt')));
  // The IPC error above is intentionally rejected; avoid a native error modal.
  await app.evaluate(({dialog})=>{dialog.showErrorBox=()=>{};});
  await click('typography');await page.locator('input[name="body"]').fill('14');await page.locator('input[name="h1"]').fill('30');await page.locator('input[name="lineHeight"]').fill('1.8');
  await page.locator('#typography-dialog button[value="apply"]').click();
  await expect.poll(()=>page.locator('.tiptap').evaluate(n=>getComputedStyle(n).fontSize)).toBe('18.6667px');
  const long=Array.from({length:28},(_,i)=>`문단 ${i+1}. `+'문서 페이지 자동 배치 테스트입니다. Hello world. '.repeat(5)).join('\n\n');
  await open('# 페이지 테스트\n\n'+long);
  await expect.poll(()=>page.locator('.page-sheet').count()).toBeGreaterThan(2);
  assert.ok(await page.locator('.page-break').count()>0);
  const a4=await page.locator('.page-sheet').first().boundingBox();
  await page.selectOption('#paper','Letter');await expect.poll(()=>page.locator('.page-sheet').first().evaluate(n=>n.getBoundingClientRect().height)).toBeLessThan(a4.height);
  // Images are real document nodes, not a second preview.
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=200;return c.toDataURL().split(',')[1];});
  const image=path.join(folder,'image.png');await fs.writeFile(image,Buffer.from(png,'base64'));
  await open('이미지 테스트');await page.locator('.tiptap').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},image);
  await click('image');await page.locator('#image-dialog button[value="absolute"]').click();await expect(page.locator('.image-block img')).toBeVisible();
  const figure=page.locator('.image-block');await figure.hover();
  const before=await figure.boundingBox(),handle=await page.locator('.image-resize-handle').boundingBox();
  await page.mouse.move(handle.x+6,handle.y+6);await page.mouse.down();await page.mouse.move(handle.x-90,handle.y-40,{steps:8});await page.mouse.up();
  const after=await figure.boundingBox();assert.ok(after.width<before.width);assert.ok(Math.abs(after.width/after.height-2)<.03);
  const resized=await page.evaluate(()=>window.markdoc.initial());assert.ok(resized.text.includes('<img'));assert.ok(/width="\d+"/.test(resized.text));
  await page.locator('.tiptap').click();await page.keyboard.press('Control+End');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await click('table');await page.locator('#table-rows').fill('4');await page.locator('#table-cols').fill('3');await page.locator('#table-dialog button[value="insert"]').click();
  await expect(page.locator('.tiptap table')).toBeVisible();assert.equal(await page.locator('.tiptap tr').count(),4);
  // An image/table near the end of a page must be moved as a unit.
  await open(Array.from({length:15},()=> '문장 한 줄').join('\n\n')+`\n\n<img src="${new URL('file:///'+image.replaceAll('\\','/')).href}" width="400" height="200" />\n\n| A | B |\n| --- | --- |\n| x | y |`);
  await page.waitForTimeout(300);
  const containment=await page.evaluate(()=>{
   const root=document.querySelector('.tiptap').getBoundingClientRect();
   const height=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-height'));
   const margin=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-margin'));
   return [...document.querySelectorAll('.tiptap .image-block,.tiptap table')].map(n=>{const r=n.getBoundingClientRect(),offset=r.top-root.top;let y=((offset%(height+24))+(height+24))%(height+24);if(y>height+23)y=0;return {tag:n.tagName,y,height:r.height,capacity:height-2*margin,fits:y+r.height<=height-2*margin+2,offset,breaks:[...document.querySelectorAll('.page-break')].map(b=>({height:b.style.height,top:b.getBoundingClientRect().top-root.top}))};});
  });assert.deepEqual(errors,[]);assert.ok(containment.every(item=>item.fits),JSON.stringify(containment));
  await menu('설정','다크 모드');assert.equal(await page.locator('.page-sheet').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(36, 36, 36)');
  assert.equal(await page.locator('.tiptap').evaluate(n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
  await app.evaluate(({ app, shell, Menu }) => {
   global.markdocPrinted = null;
   shell.openPath = async file => { global.markdocPrinted = file; return ''; };
   app.on('browser-window-created', (_event, window) => {
    const original = window.webContents.printToPDF.bind(window.webContents);
    window.webContents.printToPDF = async options => {
     global.markdocPrintColors = await window.webContents.executeJavaScript(`({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.querySelector('article')).color})`);
     return original(options);
    };
   });
   if (Menu.getApplicationMenu().items[0].submenu.items.some(item => item.label === '인쇄 미리보기')) throw new Error('Old preview menu remains');
  });
  const pdf=path.join(folder,'result.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},pdf);
  await menu('파일','PDF로 저장…');await expect.poll(async()=>fs.readFile(pdf).then(b=>b.subarray(0,4).toString()).catch(()=>''),{timeout:20000}).toBe('%PDF');
  assert.deepEqual(await app.evaluate(() => global.markdocPrintColors), {background:'rgb(255, 255, 255)',color:'rgb(0, 0, 0)'});
  await menu('파일','인쇄…');
  await expect.poll(() => app.evaluate(() => global.markdocPrinted), {timeout:20000}).toBeTruthy();
  const printed = await app.evaluate(() => global.markdocPrinted);
  assert.equal((await fs.readFile(printed)).subarray(0,4).toString(), '%PDF');
  await fs.rm(path.dirname(printed), {recursive:true,force:true});
  const saved=path.join(folder,'saved.md');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);
  await menu('파일','다른 이름으로 저장…');await expect.poll(async()=>fs.readFile(saved,'utf8').catch(()=>'' )).toContain('<img');
  await fs.mkdir(path.join(ROOT,'test-results'),{recursive:true});await page.screenshot({path:path.join(ROOT,'test-results','wysiwyg.png')});
  assert.deepEqual(errors,[]);
 } finally {
  if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});dialog.showErrorBox=()=>{};}).catch(()=>{});await app.close();}
  await fs.rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
});
