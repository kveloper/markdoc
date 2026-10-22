const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');

test('long paragraphs paginate without drawing text into page margins', { timeout: 30000 }, async () => {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(),'markdoc-layout-'));
 const env={...process.env,MARKDOC_TEST_USER_DATA:folder,MARKDOC_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  app=await _electron.launch({args:[path.resolve(__dirname,'..')],env});app.process().stdout.on('data',()=>{});app.process().stderr.on('data',()=>{});
  const page=await app.firstWindow();await page.waitForSelector('.tiptap');await page.evaluate(()=>document.fonts.ready);
  const file=path.join(folder,'long.md');await fs.writeFile(file,'긴 문단 페이지 경계 테스트입니다. Hello world. '.repeat(300));
  await app.evaluate(({dialog,Menu},file)=>{dialog.showErrorBox=()=>{};dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='열기…').click();},file);
  await page.waitForFunction(()=>document.querySelectorAll('.page-sheet').length>2);await page.waitForTimeout(150);
  const overflow=await page.evaluate(()=>{
   const root=document.querySelector('.tiptap'),top=root.getBoundingClientRect().top,css=getComputedStyle(document.documentElement),height=parseFloat(css.getPropertyValue('--page-height')),margin=parseFloat(css.getPropertyValue('--page-margin'));
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),bad=[];let node;
   while(node=walker.nextNode()){const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){let y=(rect.top-top)%(height+24);if(y>height+23)y=0;if(y<-.5||y+rect.height>height-2*margin+1)bad.push({y,height:rect.height});}}
   return bad;
  });
  if(overflow.length)console.log(await page.evaluate(()=>{const root=document.querySelector('.tiptap'),origin=root.getBoundingClientRect().top;return [...document.querySelectorAll('.page-break')].map(el=>{const range=document.createRange();range.selectNodeContents(el.nextSibling);return {top:el.getBoundingClientRect().top-origin,height:el.getBoundingClientRect().height,next:range.getClientRects()[0]?.top-origin};});}));
  assert.deepEqual(overflow,[]);
 } finally {if(app)await app.close();await fs.rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
