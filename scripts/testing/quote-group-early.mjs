/** Browser + real router/PGlite. All data is synthetic; no live CRM/Sapo calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setupEarly } from '../../tests/helpers/purchase-early-fixture.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),dir='/workspace/scratch/quote-group-early';
await mkdir(dir,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">
<main style="padding:16px"><h1>Gom xin giao trước từ báo giá</h1><section class="order-compose"><div id="sourcing"></div></section><section id="checks" hidden></section></main>
<script type="module">
import {initQuoteSourcing} from '/quote-sourcing.js';
window.writes=[];const api=async(path,method='GET',body)=>{if(method!=='GET')writes.push({path,body});const response=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw Object.assign(Error(data.message||data.error||'API error'),{status:response.status});return data;};
window.planner=await initQuoteSourcing({api,host:document.querySelector('#sourcing'),quoteId:'browser-demo',confirmBox:async()=>true});
const parsed=new DOMParser().parseFromString(await (await fetch('/index.html')).text(),'text/html');
for(const id of ['order-create-dialog','contract-dialog','view-order'])document.querySelector('#checks').append(parsed.getElementById(id));
window.ready=true;
</script>`;
let loseFirstReply=true;
const server=createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname.startsWith('/api/')){
      const path=u.pathname.slice(4)+u.search;
      if(path==='/quotes/browser-demo/stock-plan')return res.setHeader('content-type','application/json').end(JSON.stringify({quoteNo:'BG-DEMO',customerName:'Khách kiểm tra',canPurchase:true,canRequestEarly:true,warehouses:[{id:'w',name:'Kho bán kiểm tra',canSell:true,opened:true}],lines:[{sku:'031106000',name:'Bộ trà kiểm tra',unit:'Cái',qty:600,stock:{w:0},incoming:20000},{sku:'01654020803',name:'Sản phẩm thứ hai',unit:'Cái',qty:4,stock:{w:0},incoming:10}]}));
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
      const result=await f.call(path,f.cookies.mgr,req.method,body);
      if(loseFirstReply&&path==='/purchase-early-requests'&&req.method==='POST'&&body.lines.length===2){loseFirstReply=false;res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({message:'Mất phản hồi giả lập sau khi đã lưu'}));return;}
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
    // The quote's incoming row shows purchase, supplier, promised date and remaining quantity.
    const source=page.locator('#sourcing');await source.getByLabel('Nguồn hàng 031106000',{exact:true}).selectOption('incoming');
    const select=source.getByLabel('Đơn mua lấy hàng 031106000',{exact:true});await select.locator('option[value="a2"]').waitFor({state:'attached'});
    assert.match(await select.textContent(),/PO-a2.*22\/10\/2026/);await select.selectOption('a2');
    await source.getByLabel('Nguồn hàng 01654020803',{exact:true}).selectOption('incoming');
    const second=source.getByLabel('Đơn mua lấy hàng 01654020803',{exact:true});await second.locator('option[value="excel"]').waitFor({state:'attached'});await second.selectOption('excel');
    await source.screenshot({path:dir+'/quote-'+width+'.png'});
    assert.ok(await source.locator('.quote-source-row').evaluateAll(rows=>rows.every(e=>e.scrollWidth<=e.clientWidth+1)),'source controls stay inside row');
    assert.equal(await source.getByRole('button',{name:'Xin giao trước',exact:true}).count(),0);
    const before=(await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests.length;
    if(width===2021){const failed=await page.evaluate(async()=>{try{await window.planner.prepare();return false;}catch{return true;}});assert.equal(failed,true);assert.equal((await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests.length,before+1);await source.getByRole('button',{name:'Tiếp tục lưu phiếu xin giao trước',exact:true}).click();}
    else await page.evaluate(()=>window.planner.prepare());
    await source.getByRole('link',{name:'Phiếu xin giao trước chung · Nháp',exact:true}).first().waitFor();
    await page.evaluate(()=>window.planner.prepare());
    const after=(await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests;assert.equal(after.length,before+1);
    const quoteRequest=after.find(r=>r.lines.length===2&&r.lines.some(l=>l.quantity===600));assert.ok(quoteRequest);assert.equal(quoteRequest.requestStatus,'draft');
    assert.ok(quoteRequest.lines.find(l=>l.sku==='031106000').allocations.every(a=>a.orderId==='a2'));
    assert.ok(quoteRequest.lines.find(l=>l.sku==='01654020803').allocations.every(a=>a.orderId==='excel'));
    const allWrites=await page.evaluate(()=>window.writes.filter(w=>w.path==='/purchase-early-requests'));assert.equal(allWrites.length,width===2021?2:1);if(width===2021)assert.deepEqual(allWrites[0].body,allWrites[1].body);
    const quoteWrite=await page.evaluate(()=>window.writes.filter(w=>w.path==='/purchase-early-requests').at(-1));
    assert.deepEqual(quoteWrite.body.lines,[{sku:'031106000',quantity:600,sourceOrders:[{orderNo:'PO-a2',supplierOrderNo:'',quantity:600}]},{sku:'01654020803',quantity:4,sourceOrders:[{orderNo:'PO-excel',supplierOrderNo:'',quantity:4}]}]);
    const checks=await page.evaluate(()=>{
      const form=document.querySelector('#order-create-form');form.reset();const yes=form.elements.pushSapo.value==='yes';form.elements.pushSapo.value='no';const no=form.elements.pushSapo.value==='no';form.reset();
      const same=(a,b)=>document.getElementById(a).parentElement===document.getElementById(b).parentElement;
      return {sapoDefaultYes:yes&&form.elements.pushSapo.value==='yes',sapoCanDisable:no,summaryBesideCustomer:same('order-summary-card','order-customer-card'),deliveryBesideDebt:same('order-delivery-card','order-debt-card')};
    });assert.ok(Object.values(checks).every(Boolean));assert.deepEqual(errors,[]);results.push({width,pinnedOrder:'PO-a2',quotePinned:true,twoSkusOneDraft:true,repeatDoesNotCreate:true,lostReplyRecovered:width===2021,...checks});await context.close();
  }
  await writeFile(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();await f.client.close();}
