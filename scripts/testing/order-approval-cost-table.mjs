/** Local CRM router/PGlite and Chromium only; never reads or approves production contracts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import {totals} from '../../trial-ui/quote-math.js';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await setup(),
  root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const user = ok(await f.call('/me', f.mgr)).user,
  token = f.mgr.split('=')[1];
const writes = [];
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><main><button id="open">Mở chi phí</button><output id="result"></output></main><script type="module">
import {reviewOrderCosts} from '/approval-preflight.js';import {verifyBox} from '/verify.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.openCosts=(review,isManager=true)=>reviewOrderCosts({review,isManager,esc,verifyBox,toast:m=>document.querySelector('#result').textContent=m,api:async(path,method='GET',body)=>{const res=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json','authorization':'Bearer '+window.token},...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||data.message||JSON.stringify(data)),{status:res.status,code:data.code});return data;}}).then(result=>{window.result=result;});
window.verifyBox=verifyBox;window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      const path = url.pathname.slice('/api/staff'.length) + url.search;
      if (req.method !== 'GET') writes.push({ path, method: req.method, body });
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(
        path,
        bearer ? '__Host-bn-session=' + bearer : '',
        req.method,
        body,
      );
      res
        .writeHead(r.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(r.data));
      return;
    }
    if (url.pathname === '/') { res.setHeader('content-type','text/html');res.end(html);return; }
    let data = await readFile(
      root + (url.pathname === '/' ? 'index.html' : url.pathname),
    );
    if (url.pathname === '/' || url.pathname === '/index.html')
      data = Buffer.from(
        data
          .toString()
          .replace('<head>', '<head><meta name="bn-api" content="/api/staff">'),
      );
    res.setHeader(
      'content-type',
      url.pathname.endsWith('.js')
        ? 'text/javascript'
        : url.pathname.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
 for(const width of [390,1280]) {
  const data={type:'HRC',quoteNo:'COST-TABLE-'+width,vat:8,shipping:{payer:'receiver'},rows:Array.from({length:24},(_,i)=>({sku:'00123',name:'Sản phẩm tên rất dài để kiểm tra hiển thị bảng và mã hàng '+i,qty:i+1,price:200000,discount:12,costMode:i===0?'discount':'manual',...(i===0?{purchaseDiscount:25}:{}),costPrice:i===0?150000:123456.5}))};
  const q=ok(await f.call('/quotes',f.mgr,'POST',data),201);
  const original=ok(await f.call('/quotes/'+q.id,f.mgr));
  const review={quoteId:q.id,quoteRevision:original.revision,costs:{},purchaseCosts:[{index:2,source:'manual',unitCost:99999}]};
  const context=await browser.newContext({viewport:{width,height:940}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(origin);await page.waitForFunction(()=>window.ready);
  await page.evaluate(({token,review})=>{window.token=token;window.openCosts(review);},{token,review});
  let dialog=page.getByRole('dialog',{name:'Nhập đủ chi phí trước khi duyệt',exact:true});await dialog.waitFor();
  assert.equal(await dialog.locator('[data-purchase-row]').count(),24);
  assert.equal(await dialog.locator('[name="purchase-2"]').inputValue(),'99999');
  assert.equal(await dialog.locator('[name="purchase-2"]').getAttribute('readonly'),'');
  const discount=dialog.locator('[name="purchase-discount-0"]'),cost=dialog.locator('[name="purchase-0"]'),mode=dialog.locator('[name="purchase-mode-0"]');
  for(const [ck,expected]of [['0','200000'],['100','0'],['25','150000']]){await discount.fill(ck);assert.equal(await cost.inputValue(),expected);}
  await mode.selectOption('manual');await cost.fill('123456.5');
  await mode.selectOption('discount');assert.equal(await cost.inputValue(),'150000');
  await mode.selectOption('manual');await cost.fill('123456.5');
  assert.match(await dialog.locator('[data-purchase-row="0"] [data-purchase-total]').innerText(),/123.456,5/);
  await dialog.locator('[name="purchase-mode-1"]').selectOption('discount');await dialog.locator('[name="purchase-discount-1"]').fill('100');
  await dialog.locator('[name="purchase-mode-3"]').selectOption('discount');await dialog.locator('[name="purchase-discount-3"]').fill('0');
  assert.equal(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'không tràn ngang');
  for(const node of await dialog.locator('[data-check]').all())await node.check();
  await mkdir('/tmp/codex3-p1-screens',{recursive:true});await dialog.locator('.modal-body').evaluate(n=>{n.scrollTop=0;});await page.screenshot({path:'/tmp/codex3-p1-screens/costs-'+width+'.png'});
  await dialog.locator('[data-ok]').click();await page.waitForFunction(()=>window.result===true);
  let saved=ok(await f.call('/quotes/'+q.id,f.mgr));
  assert.equal(saved.data.rows[1].costPrice,0);assert.equal(saved.data.rows[1].purchaseDiscount,100);assert.equal(saved.data.rows[3].costPrice,200000);assert.equal(saved.data.rows[3].purchaseDiscount,0);
  assert.equal(saved.data.rows[0].costPrice,123456.5);assert.equal(saved.data.rows[0].costMode,'manual');assert.equal(saved.data.rows[0].purchaseDiscount,undefined);
  const withoutId=({id,...row})=>row;
  assert.deepEqual(withoutId(saved.data.rows[2]),withoutId(original.data.rows[2]));
  assert.deepEqual(totals(saved.data),totals(original.data),'giá bán/tổng tiền/VAT không đổi');
  assert.equal(saved.data.vat,8);assert.equal(saved.data.rows[0].discount,12);
  // A temporary write error leaves fields editable; explicit retry saves once successfully.
  await page.evaluate(review=>{window.result='pending';window.openCosts(review);},{...review,quoteRevision:saved.revision});await dialog.waitFor();
  await dialog.locator('[name="purchase-0"]').fill('33333.25');
  for(const node of await dialog.locator('[data-check]').all())await node.check();
  await page.route('**/api/staff/quotes/'+q.id,async route=>{if(route.request().method()==='PUT')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi thử nghiệm tạm thời'})});else await route.continue();});
  await dialog.locator('[data-ok]').click();await dialog.locator('[data-err]').filter({hasText:'Lỗi thử nghiệm'}).waitFor();
  assert.equal(await dialog.locator('[name="purchase-0"]').inputValue(),'33333.25');
  await page.unroute('**/api/staff/quotes/'+q.id);await dialog.locator('[data-ok]').click();await page.waitForFunction(()=>window.result===true);
  saved=ok(await f.call('/quotes/'+q.id,f.mgr));assert.equal(saved.data.rows[0].costPrice,33333.25);
  // Reopen, then a different local request changes the revision before submission.
  const latest={...review,quoteRevision:saved.revision};
  await page.evaluate(review=>{window.result='pending';window.openCosts(review);},latest);await dialog.waitFor();
  await dialog.locator('[name="purchase-0"]').fill('76543.25');
  ok(await f.call('/quotes/'+q.id,f.mgr,'PUT',{revision:saved.revision,data:{...saved.data,notes:'Thay đổi từ phiên khác'}}));
  for(const node of await dialog.locator('[data-check]').all())await node.check();
  await dialog.locator('[data-ok]').click();await dialog.locator('[data-err]').filter({hasText:'Thông tin đang nhập được giữ lại'}).waitFor();
  assert.equal(await dialog.locator('[name="purchase-0"]').inputValue(),'76543.25');
  assert.equal(await dialog.locator('[data-ok]').isEnabled(),true);
  assert.equal(await dialog.isVisible(),true);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  // Non-manager with complete costs must never fetch the cost source.
  const count=writes.length;
  await page.evaluate(review=>{window.result='pending';window.openCosts(review,false);},latest);
  dialog=page.getByRole('dialog',{name:'Kiểm tra chi phí trước khi duyệt',exact:true});await dialog.waitFor();assert.equal(await dialog.locator('[name^="purchase-"]').count(),0);await page.keyboard.press('Escape');assert.equal(writes.length,count);
  // Shared verifyBox: no hook keeps the compact behaviour; async hook blocks duplicate submissions.
  await page.evaluate(()=>{window.generic='pending';window.verifyBox({title:'Đối chiếu khác',rows:[['Khách','Khách thử']],checks:['Xác nhận']}).then(v=>window.generic=v);});
  let generic=page.getByRole('dialog',{name:'Đối chiếu khác',exact:true});await generic.waitFor();
  assert.equal(await generic.locator('[data-ok]').isDisabled(),true);await generic.locator('[data-check]').check();await generic.locator('[data-ok]').click();await generic.waitFor({state:'hidden'});
  await page.evaluate(()=>{window.submits=0;window.generic='pending';window.verifyBox({title:'Lưu có chờ',checks:['Xác nhận'],beforeConfirm:()=>{window.submits++;return new Promise(resolve=>window.finishSave=resolve);}}).then(v=>window.generic=v);});
  generic=page.getByRole('dialog',{name:'Lưu có chờ',exact:true});await generic.waitFor();await generic.locator('[data-check]').check();await generic.locator('[data-ok]').click();
  await page.waitForFunction(()=>window.submits===1);assert.equal(await generic.locator('[data-ok]').isDisabled(),true);
  await generic.locator('form').evaluate(n=>n.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.keyboard.press('Escape');assert.equal(await generic.isVisible(),true);assert.equal(await page.evaluate(()=>window.submits),1);
  await page.evaluate(()=>window.finishSave('Lỗi thử hook'));await generic.locator('[data-err]').filter({hasText:'Lỗi thử hook'}).waitFor();assert.equal(await generic.locator('[data-ok]').isEnabled(),true);await page.keyboard.press('Escape');await generic.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,rows:24,discountBoundaries:true,fractionalDirectCost:true,lockedUnchanged:true,revisionConflictRetainsForm:true,jsErrors:0}));
  await context.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
