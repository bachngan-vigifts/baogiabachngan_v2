/** Inventory create/save/cancel at portrait, landscape and desktop sizes; lost ACK after commit must replay safely. Local fixture only. */
import assert from 'node:assert/strict';
import {inventoryAdjustments,stockBalances} from '../../src/modules/inventory/schema.ts';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup();
const root = process.env.UI_ROOT || fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
let loseNext=false;const posts=[];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(url.pathname.slice('/api/staff'.length) + url.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      if(req.method==='POST'&&url.pathname.endsWith('/inventory/adjustments')){posts.push({body,status:r.status});if(loseNext&&r.status===201){loseNext=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Simulated lost response after commit'}));return;}}
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return;
    }
    let data = await readFile(root + (url.pathname === '/' ? 'index.html' : url.pathname));
    if (url.pathname === '/' || url.pathname === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch (e) { res.writeHead(404).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });

const outDir=process.env.MOBILE_SCREENSHOT_DIR||'/workspace/artifacts/mobile-inventory-actions';await mkdir(outDir,{recursive:true});
const results=[];
try {
 for(const [width,height] of [[390,844],[430,932],[932,430],[1280,900]]){
  const context=await browser.newContext({viewport:{width,height},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/inventory');
  const add=page.getByRole('button',{name:'Tạo phiếu cân bằng kho',exact:true});await add.waitFor({state:'visible'});await add.click();
  const form=page.locator('.inv-adjust-form');await form.waitFor();
  const save=form.getByRole('button',{name:'Ghi phiếu điều chỉnh',exact:true}),cancel=form.getByRole('button',{name:'Huỷ',exact:true});
  assert.ok(await save.isVisible());assert.ok(await cancel.isVisible());
  await form.getByLabel('Kho cân bằng').selectOption('pos-wh');
  await form.locator('input[placeholder^="VD:"]').fill('Test mobile '+width);
  await form.getByLabel('Mã hàng',{exact:true}).fill('00123');await form.getByLabel('Số tăng / giảm').fill('1');
  // Rotating while editing preserves values and visible submit/cancel.
  await page.setViewportSize({width:width<=430?932:390,height:width<=430?430:844});await page.waitForTimeout(350);
  assert.ok(await save.isVisible());assert.equal(await form.getByLabel('Mã hàng',{exact:true}).inputValue(),'00123');
  await page.setViewportSize({width,height});await page.waitForTimeout(350);await save.scrollIntoViewIfNeeded();
  assert.ok(await save.isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:outDir+'/fixed-'+width+'.png',fullPage:true});
  const before=posts.length;loseNext=width===390;await save.click();
  if(width===390){const retry=form.getByRole('button',{name:'Kiểm tra lại lần gửi',exact:true});await retry.waitFor({state:'visible'});await retry.click();}
  await form.waitFor({state:'hidden'});assert.equal(posts.length-before,width===390?2:1);
  if(width===390){assert.equal(posts[before].body.clientKey,posts[before+1].body.clientKey);assert.equal(posts[before+1].status,200);}
  await add.click();await cancel.waitFor();const n=posts.length;await cancel.click();await form.waitFor({state:'hidden'});assert.equal(posts.length,n,'cancel never writes');
  assert.deepEqual(errors,[]);results.push({width,height,create:true,save:true,cancel:true,rotate:true,lostAck:width===390});await context.close();
 }
 const docs=await f.db.select().from(inventoryAdjustments);assert.equal(docs.length,4,'one document per submit despite lost ACK');
 const balances=await f.db.select().from(stockBalances);assert.equal(balances.find(r=>r.sku==='00123'&&r.warehouseId==='pos-wh').qty,14);
 await writeFile(outDir+'/results.json',JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
