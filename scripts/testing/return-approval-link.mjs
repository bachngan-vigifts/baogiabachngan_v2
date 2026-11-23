/** Reopen a POS return from the approval inbox, including recovery after a failed read. Local fixture only; never approves/refunds. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup();
const root = process.env.UI_ROOT || fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const shift=await f.open();
const sale=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{tendered:300000}));assert.equal(sale.status,201,JSON.stringify(sale.data));
const detail=await f.call('/pos/returns?orderId='+sale.data.id,f.emp);
const made=await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),orderId:sale.data.id,shiftId:shift.id,reason:'Test approval deep link',lines:detail.data.lines.map(l=>({orderLineId:l.id,qty:l.qty}))});assert.equal(made.status,201,JSON.stringify(made.data));
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
let failReturnRead=false,returnReads=0;const posts=[];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      if(req.method==='GET'&&url.pathname.endsWith('/pos/returns')&&url.searchParams.has('orderId')){returnReads++;if(failReturnRead){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Test temporary return read error'}));return;}}
      const r = await f.call(url.pathname.slice('/api/staff'.length) + url.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      if(req.method!=='GET')posts.push({path:url.pathname,method:req.method});
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



const out=process.env.REVIEW_DIR||'/workspace/artifacts/return-approval-link';await mkdir(out,{recursive:true});
const results=[];
try {
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function clickApproval(){await page.goto(origin+'/#/tasks');await page.locator('#tasks-view [data-v="approvals"]').click();await page.locator('tr').filter({hasText:made.data.returnNo}).getByRole('link',{name:'Mở để duyệt'}).click();}
  const modal=page.locator('.pos-return-modal[open]');
  const before=posts.length;
  for(let attempt=0;attempt<3;attempt++){
   await clickApproval();await modal.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).waitFor();
   assert.ok((await modal.innerText()).includes(made.data.returnNo));
   assert.equal(await modal.count(),1);
   if(attempt===1)await page.screenshot({path:out+'/reopened-'+width+'.png'});
   await modal.getByRole('button',{name:'Đóng',exact:true}).click();await modal.waitFor({state:'hidden'});
  }
  failReturnRead=true;const reads=returnReads;await clickApproval();
  await page.waitForTimeout(200);
  await modal.waitFor({state:'hidden'});assert.ok(returnReads>reads);failReturnRead=false;
  await clickApproval();await modal.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).waitFor();
  assert.ok((await modal.innerText()).includes(made.data.returnNo));
  assert.equal(posts.length,before,'opening/closing/retrying never writes return/payment');assert.deepEqual(errors,[]);
  await ctx.close();results.push({width,repeatedOpen:true,retryAfterFailure:true,noApprovalOrFinancialWrites:true});
 }
 console.log('PASS',JSON.stringify(results));await writeFile(out+'/results.json',JSON.stringify(results,null,2));
}finally {await browser.close();server.close();await f.client.close();}
