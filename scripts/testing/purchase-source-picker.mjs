/** Browser + real router/PGlite. All data is synthetic; no live CRM/Sapo calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setupEarly } from '../../tests/helpers/purchase-early-fixture.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),dir='/workspace/scratch/purchase-source-picker';
await mkdir(dir,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">
<main style="padding:16px"><h1>Chọn đơn mua để lấy hàng</h1><section id="incoming"></section><section class="order-compose"><div id="sourcing"></div></section><section id="checks" hidden></section></main>
<script type="module">
import {initPurchaseIncoming} from '/purchase-incoming.js';import {initQuoteSourcing} from '/quote-sourcing.js';
window.writes=[];const api=async(path,method='GET',body)=>{if(method!=='GET')writes.push({path,body});const response=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw Object.assign(Error(data.message||data.error||'API error'),{status:response.status});return data;};
window.ui=initPurchaseIncoming({api,host:document.querySelector('#incoming'),go:()=>{}});await ui.show();
window.planner=await initQuoteSourcing({api,host:document.querySelector('#sourcing'),quoteId:'browser-demo',confirmBox:async()=>true});
const parsed=new DOMParser().parseFromString(await (await fetch('/index.html')).text(),'text/html');
for(const id of ['order-create-dialog','contract-dialog','view-order'])document.querySelector('#checks').append(parsed.getElementById(id));
window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname.startsWith('/api/')){
      const path=u.pathname.slice(4)+u.search;
      if(path==='/quotes/browser-demo/stock-plan')return res.setHeader('content-type','application/json').end(JSON.stringify({quoteNo:'BG-DEMO',customerName:'Khách kiểm tra',canPurchase:true,canRequestEarly:true,warehouses:[{id:'w',name:'Kho bán kiểm tra',canSell:true,opened:true}],lines:[{sku:'031106000',name:'Bộ trà kiểm tra',unit:'Cái',qty:600,stock:{w:0},incoming:20000}]}));
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const result=await f.call(path,f.cookies.mgr,req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
      res.writeHead(result.status,{'content-type':'application/json'}).end(JSON.stringify(result.data));return;
    }
    res.setHeader('content-type',u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    res.end(u.pathname==='/'?html:await readFile(root+u.pathname.slice(1)));
  }catch(e){res.writeHead(500).end(e.message);}
}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
  for(const width of [2021,1280,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);
    // Select the later order, not the default earliest PO-a1, and preserve it in the actual saved draft.
    const incoming=page.locator('#incoming');await incoming.getByLabel('SL cần lấy trước mã 031106000',{exact:true}).fill('500');
    await incoming.getByLabel('Lấy mã 031106000 từ PO-a2',{exact:true}).check();
    assert.equal(await incoming.getByLabel('SL mã 031106000 lấy từ PO-a2',{exact:true}).inputValue(),'500');
    await incoming.getByLabel('SL mã 031106000 lấy từ PO-a2',{exact:true}).fill('7001');
    assert.equal(await incoming.getByRole('button',{name:'Lưu và gửi NCC',exact:true}).isDisabled(),true);
    await incoming.getByLabel('SL mã 031106000 lấy từ PO-a2',{exact:true}).fill('500');
    await incoming.screenshot({path:dir+'/incoming-'+width+'.png'});
    await incoming.getByRole('button',{name:'Lưu và gửi NCC',exact:true}).click();
    const dialog=page.locator('.early-request-dialog');await dialog.getByLabel('Số lượng nháp mã 031106000 · PO-a2',{exact:true}).waitFor();
    await dialog.getByLabel('Ngày lấy',{exact:true}).fill('2026-11-05');
    await dialog.getByRole('button',{name:'Lưu nháp',exact:true}).click();
    await dialog.getByRole('button',{name:'Gửi NCC',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.early-request-dialog button')).find(b=>b.textContent==='Gửi NCC').disabled);
    const create=await page.evaluate(()=>window.writes.find(w=>w.path==='/purchase-early-requests'));
    assert.deepEqual(create.body.lines,[{sku:'031106000',quantity:500,sourceOrders:[{orderNo:'PO-a2',supplierOrderNo:'',quantity:500}]}]);
    await dialog.getByRole('button',{name:'Gửi NCC',exact:true}).click();await dialog.waitFor({state:'detached'});
    const requests=(await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests;
    const saved=requests.find(r=>r.scope.orderSources&&r.lines.some(l=>l.quantity===500)&&r.requestStatus==='submitted');assert.ok(saved);
    assert.ok(saved.lines[0].allocations.every(a=>a.orderId==='a2'));
    // The quote's incoming row shows purchase, supplier, promised date and remaining quantity.
    const source=page.locator('#sourcing');await source.getByLabel('Nguồn hàng 031106000',{exact:true}).selectOption('incoming');
    const select=source.getByLabel('Đơn mua lấy hàng 031106000',{exact:true});await select.locator('option[value="a2"]').waitFor({state:'attached'});
    assert.match(await select.textContent(),/PO-a2.*22\/10\/2026/);await select.selectOption('a2');
    await source.screenshot({path:dir+'/quote-'+width+'.png'});
    assert.ok(await source.locator('.quote-source-row').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'source controls stay inside row');
    await source.getByRole('button',{name:'Xin giao trước',exact:true}).click();
    await source.getByRole('link',{name:'Phiếu xin lấy trước · Nháp',exact:true}).waitFor();
    const quoteWrite=await page.evaluate(()=>window.writes.filter(w=>w.path==='/purchase-early-requests').at(-1));
    assert.deepEqual(quoteWrite.body.lines,[{sku:'031106000',quantity:600,sourceOrders:[{orderNo:'PO-a2',supplierOrderNo:'',quantity:600}]}]);
    const checks=await page.evaluate(()=>{
      const form=document.querySelector('#order-create-form');form.reset();const yes=form.elements.pushSapo.value==='yes';form.elements.pushSapo.value='no';const no=form.elements.pushSapo.value==='no';form.reset();
      const same=(a,b)=>document.getElementById(a).parentElement===document.getElementById(b).parentElement;
      return {sapoDefaultYes:yes&&form.elements.pushSapo.value==='yes',sapoCanDisable:no,summaryBesideCustomer:same('order-summary-card','order-customer-card'),deliveryBesideDebt:same('order-delivery-card','order-debt-card')};
    });assert.ok(Object.values(checks).every(Boolean));assert.deepEqual(errors,[]);results.push({width,pinnedOrder:'PO-a2',incomingSavedAndSubmitted:true,quotePinned:true,...checks});await context.close();
  }
  await writeFile(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();await f.client.close();}
