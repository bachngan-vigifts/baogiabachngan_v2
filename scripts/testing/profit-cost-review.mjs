/** Browser checks against real profit module/API and an isolated Postgres fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { profitCostReviewFixture } from '../../tests/helpers/profit-cost-review-fixture.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), out = '/tmp/profit-cost-review-browser';
await mkdir(out, { recursive: true });
const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/mobile-design.css"><link rel="stylesheet" href="/profit.css"><section id="view-profit"></section><script type="module">import {initProfit} from '/profit.js';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error||d.message||'Lỗi');return d;};initProfit({root:document.querySelector('#view-profit'),api,toast:()=>{},esc,money:n=>n.toLocaleString('vi-VN')+' ₫'}).show();</script></html>`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }), results = [];
try {
 for (const width of [1440, 390]) {
  const f = await profitCostReviewFixture(), requests = [], errors = [];
  const server = createServer(async (req, res) => { try {
   const u = new URL(req.url, 'http://localhost');
   if (u.pathname.startsWith('/api/staff/')) {
    let raw='';for await(const chunk of req)raw+=chunk;
    const path=u.pathname.slice(10)+u.search,body=raw?JSON.parse(raw):undefined;requests.push({path,method:req.method,body});
    const r=await f.call(path,f.mgr,req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
   }
   if(u.pathname==='/'){res.writeHead(200,{'content-type':'text/html'}).end(html);return;}
   res.writeHead(200,{'content-type':u.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(root+u.pathname));
  }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port,c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
  await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await c.addInitScript(()=>Date.now=()=>Date.parse('2026-11-07T03:00:00Z'));
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  try {
   await p.goto(origin);await p.locator('#pf-confirm').click();const dlg=p.locator('dialog.pf-fill');
   await dlg.waitFor();assert.equal(await dlg.locator('[data-discount="0"]').inputValue(),'58');assert.equal(await dlg.locator('[data-i="0"]').isEditable(),false);
   await dlg.locator('[data-discount="0"]').fill('25');assert.equal(await dlg.locator('[data-i="0"]').inputValue(),'75000');
   await dlg.locator('[data-discount="0"]').fill('100');assert.equal(await dlg.locator('[data-i="0"]').inputValue(),'0');
   await dlg.locator('[data-discount="0"]').fill('0');assert.equal(await dlg.locator('[data-i="0"]').isEditable(),true);
   await dlg.locator('[data-i="0"]').fill('55000');await dlg.locator('[name=reason]').fill('');
   await dlg.locator('.modal-foot .primary').click();assert.equal(requests.filter(r=>r.method==='POST').length,0,'lý do bắt buộc');
   await dlg.locator('[data-discount="0"]').fill('101');await dlg.locator('[name=reason]').fill('Theo hoá đơn NCC');await dlg.locator('.modal-foot .primary').click();assert.equal(requests.filter(r=>r.method==='POST').length,0);
   await dlg.locator('[data-discount="0"]').fill('25');
   const overflow=await dlg.evaluate(d=>({dialog:d.scrollWidth>d.clientWidth+1,table:d.querySelector('.table-wrap').scrollWidth>d.querySelector('.table-wrap').clientWidth+1}));assert.deepEqual(overflow,{dialog:false,table:false});
   await p.screenshot({path:out+'/'+width+'-confirm.png'});
   await dlg.locator('.modal-foot .primary').click();await dlg.waitFor({state:'detached'});
   assert.equal(requests.find(r=>r.method==='POST').body.items[0].unitCost,75000);
   await p.locator('#pf-fill').click();await dlg.waitFor();
   const plain=dlg.locator('tr[data-cost-row]').filter({hasText:'PLAIN'}).filter({hasText:'Giá bán lẻ VAT'}), none=dlg.locator('tr[data-cost-row]').filter({hasText:'NONE'});
   assert.equal(await plain.count(),1);assert.equal(await plain.locator('input[data-i]').isEditable(),true);assert.equal(await none.locator('input[data-discount]').isDisabled(),true);
   await plain.locator('input[data-i]').fill('65000');await none.locator('input[data-i]').fill('12000.5');await dlg.locator('[name=reason]').fill('Giá nhập đối chiếu NCC');
   await p.screenshot({path:out+'/'+width+'-manual.png'});await dlg.locator('.modal-foot .primary').click();await dlg.waitFor({state:'detached'});
   const detail=await f.call('/profit/orders/review-order',f.mgr);assert.equal(detail.data.lines.find(l=>l.id==='review-PLAIN').unitCost,65000);assert.equal(detail.data.lines.find(l=>l.id==='review-NONE').unitCost,12000.5);
   assert.deepEqual(errors,[]);results.push({width,discount:true,zeroAnd100:true,manual:true,requiredReason:true,invalidDiscount:true,noOverflow:true,apiPersistence:true,errors});
  }finally{await c.close();await new Promise(r=>server.close(r));await f.client.close();}
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
