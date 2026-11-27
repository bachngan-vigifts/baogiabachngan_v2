// Full UI → local API/PGlite regression. No real network or transactions.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {setupSepay} from '../../tests/helpers/sepay-fixture.ts';
import {deliveries,salesOrders,customerPayments} from '../../src/modules/sales/schema.ts';
import {eq} from '../../node_modules/drizzle-orm/index.js';
import {syncPosLockGhn} from '../../src/modules/sales/api/pos-ghn-sync.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
globalThis.fetch=async()=>{throw Error('Real network forbidden in QA')};
const f=await setupSepay(),shift=await f.open(),results:any[]=[];
let code=''; const mockedCalls:any[]=[];
f.env.ghnToken='fixture-only';f.env.ghnFetch=async(input,init)=>{mockedCalls.push(String(input));return Response.json({code:200,data:{order_code:code,total_fee:5000,status:'delivered',updated_date:new Date().toISOString()}})};
const report=async()=>{
 const range='from=2026-11-01&to=2026-11-30';
 const book=await f.call('/cashbook?'+range,f.mgr),cash=await f.call('/cash/entries?'+range+'&method=all',f.mgr),daily=await f.call('/tasks/accounting/daily?date=2026-11-27',f.mgr),finance=await f.call('/finance/cashflow?'+range+'&refresh=1',f.mgr);
 for(const r of [book,cash,daily,finance])assert.equal(r.status,200,JSON.stringify(r.data));
 return {cashbook:book.data.totals,bookRows:book.data.entries.map(x=>({amount:x.amount,method:x.method,note:x.note})),cash:cash.data.totals,daily:daily.data.customerReceipts,finance:finance.data.flow};
};
const source=await readFile(new URL('../../trial-ui/sepay-allocations.js',import.meta.url));
const server=createServer(async(req,res)=>{try{if(req.url==='/module.js'){res.setHeader('Content-Type','text/javascript');res.end(source);return}if(req.url?.startsWith('/api/')){let body='';for await(const b of req)body+=b;const r=await f.call(req.url.slice(4),f.mgr,req.method,body?JSON.parse(body):undefined);res.statusCode=r.status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r.data));return}res.setHeader('Content-Type','text/html');res.end('<div id="root"></div>')}catch(e){res.statusCode=500;res.end(String(e))}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();
await page.addInitScript('window.__name=(fn)=>fn');
await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
try{
for(const amount of [95000,94900,95100,100000]){
 code='QA'+amount;const actualFee=amount===100000?0:5000;
 const made=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{pricePolicyId:'retail',rows:[{sku:'00123',qty:1,discountType:'percent',discountValue:0}],fulfillmentMode:'cod',delivery:{address:'123 Fixture',receiverName:'Fixture',receiverPhone:'0901234567',plannedDate:'2026-11-27',ghnProvinceId:202,ghnDistrictId:1442,ghnWardCode:'20101',ghnWeight:800}}));
 assert.equal(made.status,201,JSON.stringify(made.data));assert.equal(made.data.ghnShipment.fee,5000);const oid=made.data.id;
 const [o]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,oid));assert.equal(o.total,100000);
 await syncPosLockGhn(f.env);
 const [d]=await f.db.select().from(deliveries).where(eq(deliveries.orderId,oid));const [p]=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,oid));assert.equal(p.amount,100000);assert.equal(p.paymentSource,'ghn_cod');
 const e=await f.incoming('QA bank '+amount,amount);const path=`/sepay/transactions/${e.id}`;
 const cs=await f.call(path+'/allocation-candidates?source=ghn',f.mgr);const candidate=cs.data.candidates.find((c:any)=>c.targetId===oid);assert.ok(candidate);
 await page.goto(origin);await page.evaluate(async(id)=>{const {initSepayAllocations}=await import('/module.js');const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||JSON.stringify(data)),{status:r.status});return data};window.ui=initSepayAllocations({api,root:document.querySelector('#root'),go(){}});await window.ui.show(id)},e.id);
 await page.locator(`[data-add="${oid}"]`).click();await page.locator('[data-receipt]').selectOption(p.id);
 const reportsBefore=await report();
 const auto={amount:await page.locator('[data-amount]').inputValue(),fee:await page.locator('[data-ghn-fee]').inputValue(),review:await page.locator('[data-review]').isEnabled()};
 await page.locator('[data-ghn-fee]').fill(String(actualFee));await page.locator('[data-bank-remaining]').click();const manual={review:await page.locator('[data-review]').isEnabled(),difference:await page.locator('[data-line-difference]').innerText(),debtLabel:await page.locator('[data-after]').innerText()};
 let apiResult;
 if(manual.review){await page.locator('[data-review]').click();await page.locator('[data-verified]').check();await page.locator('[data-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-lines]')?.textContent?.includes('Chọn'));apiResult={status:200};}
 else apiResult=await f.call(path+'/allocations',f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:oid,existingPaymentId:p.id,amount,expectedAmount:100000,ghnFee:actualFee,differenceConfirmed:true}]});
 assert.equal(manual.review,true,JSON.stringify(manual));assert.equal(manual.debtLabel,'Còn nợ 0 ₫');assert.equal(apiResult.status,200);
 const after=(await f.call(path+'/allocations',f.mgr)).data;const debt=(await netReceivables(f.db,[oid],'2026-11-27')).get(oid);const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,oid));
 results.push({reportsBefore,reportsAfter:await report(),amount,order:oid,snapshot:JSON.parse(o.posSnapshot).ghn,shippingFee:d.shippingFee,ghnCode:candidate.ghnCode,feeHint:candidate.ghnFeeHint,auto,manual,apiResult,customerDebt:debt?.balance,receiptAmounts:receipts.map(x=>({amount:x.amount,source:x.paymentSource,voided:x.voidedAt})),allocation:after});
 assert.equal(after.allocations[0].difference,amount+actualFee-100000);assert.equal(debt?.balance,0);assert.equal(receipts.length,1);assert.equal(receipts[0].amount,100000);
 const history=await page.locator('.sa-history').innerText();assert.match(history,/Khách đã trả COD/);if(amount===94900)assert.match(history,/GHN chuyển thiếu 100/);if(amount===95100)assert.match(history,/GHN chuyển dư 100/);
 await page.locator('[data-void]').click();await page.locator('[data-void-form] textarea').fill('QA undo');await page.locator('[data-void-form] input[type=checkbox]').check();await page.locator('[data-void-form] button').click();await page.waitForFunction(()=>document.querySelector('.sa-history')?.textContent?.includes('Đã gỡ'));
 const undone=(await f.call(path+'/allocations',f.mgr)).data;assert.equal(undone.remaining,amount);assert.ok(undone.allocations[0].voidedAt);assert.equal((await netReceivables(f.db,[oid],'2026-11-27')).get(oid)?.balance,0);
 // Isolated fixture mutations to check stale snapshot / manual carrier through same SePay candidates API.
 if(amount===94900){for(const carrier of ['GHN','Nhất Tín']){await f.db.update(deliveries).set({trackingCode:'NEWCODE',carrier}).where(eq(deliveries.id,d.id));const r=await f.call(path+'/allocation-candidates',f.mgr);const c=r.data.candidates.find((x:any)=>x.targetId===oid);results.push({case:'changed code / carrier',carrier,snapshotCode:JSON.parse(o.posSnapshot).ghn.orderCode,activeCode:'NEWCODE',hint:c?.ghnFeeHint,ghnCode:c?.ghnCode});}}
}
const beforeCalls=mockedCalls.length;
const manualOrder=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{pricePolicyId:'retail',rows:[{sku:'00123',qty:1,discountType:'percent',discountValue:0}],fulfillmentMode:'cod',delivery:{address:'123 Fixture',receiverName:'Fixture',receiverPhone:'0901234567',plannedDate:'2026-11-27',deliveryMethod:'nhat_tin',carrierName:'Nhất Tín',trackingCode:'NT001'}}));
assert.equal(manualOrder.status,201,JSON.stringify(manualOrder.data));assert.equal(mockedCalls.length,beforeCalls);
const [mo]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,manualOrder.data.id));
await f.db.update(salesOrders).set({posSnapshot:JSON.stringify({...JSON.parse(mo.posSnapshot),ghn:{orderCode:'OLDGHN',fee:5000}})}).where(eq(salesOrders.id,mo.id));
const me=await f.incoming('QA manual carrier',95000),mp=`/sepay/transactions/${me.id}`;
const mc=(await f.call(mp+'/allocation-candidates',f.mgr)).data.candidates.find((c:any)=>c.targetId===mo.id);
const mr=await f.call(mp+'/allocations',f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:mo.id,amount:95000,ghnFee:5000,expectedAmount:100000}]});
assert.equal(mc.ghnFeeHint,0);assert.equal(mc.ghnCode,'');assert.equal(mr.status,409);
results.push({case:'created manual Nhất Tín, injected stale GHN snapshot',callsToGhn:mockedCalls.length-beforeCalls,ghnCode:mc.ghnCode,feeHint:mc.ghnFeeHint,allocationStatus:mr.status,error:mr.data});
console.log(JSON.stringify({results,mockedCalls},null,2));await writeFile('/tmp/ghn-pos-difference-results.json',JSON.stringify({results,mockedCalls},null,2));
}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await f.client.close();}
