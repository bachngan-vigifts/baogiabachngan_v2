import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {posRegisters,webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders,salesOrderLines,customerPayments} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {sapoOrderStatuses} from '../../src/modules/integrations/schema.ts';
const SECRET='only-fixture-sapo-sync-token-12345678901234567890';
async function fixture(){
 const f=await setup({viaClaw:true});f.env.sapoSyncToken=SECRET;f.env.sapoOrderPush=undefined;
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const body={id:21569,number:'21569',status:'processing',total:'226550',currency:'VND',billing:{first_name:'Khách kiểm thử',phone:'0900000022'},line_items:[{sku:'00123',name:'Ly sứ',quantity:2,subtotal:'220000',subtotal_tax:'17600',total:'200000',total_tax:'16000'}],shipping_total:'10000',shipping_tax:'0',discount_total:'20000',discount_tax:'1600',total_tax:'16050',coupon_lines:[{code:'TEST',discount:'20000',discount_tax:'1600'}],fee_lines:[{name:'Dịch vụ',total:'500',total_tax:'50'}],shipping_lines:[],date_created_gmt:'2026-11-06T01:00:00Z'};
 const sync=(extra:Record<string,unknown>={})=>f.call('/integrations/woocommerce/lock/order?token=test-lock-token','','POST',{...body,...extra});assert.equal((await sync()).status,200);
 const [o]=await f.db.select().from(web),id='web:'+o!.id,path='/orders/'+encodeURIComponent(id);
 const list=async(cookie=f.mgr)=>{const r=await f.call('/orders?flow=order',cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.orders;};
 const callback=async(b:object,token=SECRET)=>{const r=await f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/order-status',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(b)}),f.env);return {status:r.status,data:await r.json() as any};};
 const snapshot=async()=>({orders:await f.db.select().from(salesOrders),lines:await f.db.select().from(salesOrderLines),payments:await f.db.select().from(customerPayments),stock:await f.db.select().from(stockMoves)});
 return {...f,id,path,webId:o!.id,sync,list,callback,snapshot};
}
test('list exposes existing Sapo links and creation capability for CRM/POS without granting read-only staff export access',async()=>{
 const f=await fixture();await f.db.insert(salesOrders).values([{id:'crm-linked',orderNo:'DH-linked',quoteType:'HRC',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-06',status:'confirmed',sapoOrderId:'9001',sapoOrderCode:'SON9001',customerName:'Khách liên kết',createdAt:'',updatedAt:''},{id:'crm-new',orderNo:'DH-new',quoteType:'HRC',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-06',status:'confirmed',customerName:'Khách chưa liên kết',createdAt:'',updatedAt:''},{id:'crm-cancelled',orderNo:'DH-cancelled',quoteType:'HRC',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-06',status:'cancelled',customerName:'Khách huỷ',createdAt:'',updatedAt:''}]);
 const list=await f.list();assert.match(list.find((o:any)=>o.id==='crm-linked').sapoOrderUrl,/\/orders\/9001$/);assert.equal(list.find((o:any)=>o.id==='crm-linked').canCreateSapo,false);assert.equal(list.find((o:any)=>o.id==='crm-new').canCreateSapo,true);assert.equal(list.find((o:any)=>o.id==='crm-cancelled').canCreateSapo,false);
 await f.db.update(employees).set({positionId:'accounting'}).where(eq(employees.id,'emp'));const readonly=await f.list(f.emp);assert.equal(readonly.find((o:any)=>o.id==='crm-new').canCreateSapo,false);
 assert.equal((await f.call('/orders/crm-new/sapo',f.emp,'POST',{})).status,403);
});
test('web create sends exact net/tax/discount/fees to Claw with one stable reference; repeat click never duplicates CRM stock or receipts',async()=>{
 const f=await fixture(),before=await f.snapshot();let o=(await f.list()).find((r:any)=>r.id===f.id);assert.equal(o.canCreateSapo,true);assert.equal(o.sapoOrderUrl,'');
 const preview=await f.call('/sapo/preview?orderId='+encodeURIComponent(f.id),f.mgr);assert.equal(preview.status,200);assert.deepEqual(preview.data.problems,[]);assert.equal(preview.data.code,'WEB_LOCK_21569');
 const result=await f.call(f.path+'/sapo',f.mgr,'POST',{});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.sapo.status,'updating');assert.equal(f.hooks.length,1);
 const p=f.hooks[0]!.body;assert.equal(p.idempotency_key,'pos:WEB_LOCK_21569');assert.equal(p.quote_number,'WEB_LOCK_21569');assert.equal(p.external_reference,'WEB_LOCK_21569');assert.equal(p.items[0].discount_amount,0);assert.equal(p.items[0].line_total,200000);assert.equal(p.items[0].unit_price,100000);assert.equal(p.items[0].tax_percent,8);assert.equal(p.subtotal,210500);assert.equal(p.vat_amount,16050);assert.equal(p.total,226550);assert.equal(p.additional_fees.shipping.amount,10000);assert.equal(p.additional_fees.service.amount,550);assert.equal(p.branch.register_id,f.registerId);
 assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,200);assert.equal(f.hooks.length,1);assert.deepEqual(await f.snapshot(),before);
 o=(await f.list()).find((r:any)=>r.id===f.id);assert.equal(o.canCreateSapo,false);assert.equal(o.sapoPending,true);
});
test('authenticated result callback changes web row to View Sapo, is replay safe and rejects relinking another order',async()=>{
 const f=await fixture();await f.call(f.path+'/sapo',f.mgr,'POST',{});
 const body={quote_number:'WEB_LOCK_21569',status:'created',sapo_order_id:9002,sapo_order_code:'SON9002'};
 assert.equal((await f.callback(body,'wrong')).status,401);assert.equal((await f.callback(body)).status,200);assert.equal((await f.callback(body)).status,200);assert.equal((await f.callback({...body,sapo_order_id:9003})).status,409);
 const o=(await f.list()).find((r:any)=>r.id===f.id);assert.match(o.sapoOrderUrl,/\/orders\/9002$/);assert.equal(o.sapoOrderCode,'SON9002');assert.equal(o.canCreateSapo,false);assert.equal(o.sapoPending,false);
 const result=await f.call(f.path+'/sapo',f.mgr,'POST',{});assert.equal(result.data.sapo.status,'existing');assert.equal(f.hooks.length,1);assert.equal((await f.db.select().from(salesOrders)).length,0);
 await f.callback({quote_number:'WEB_LOCK_21569',status:'failed'});assert.match((await f.call(f.path,f.mgr)).data.document.sapoOrderUrl,/\/9002$/);
});
test('store permissions, cancelled orders, source conflicts and disabled export prevent web hooks',async()=>{
 const f=await fixture();await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'emp'));
 assert.equal((await f.call(f.path+'/sapo',f.emp,'POST',{})).status,404);assert.equal((await f.call('/sapo/preview?orderId='+encodeURIComponent(f.id),f.emp)).status,404);
 await f.db.update(web).set({status:'cancelled'}).where(eq(web.id,f.webId));assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,409);
 await f.db.update(web).set({status:'processing',crmEditSnapshot:JSON.stringify({sourceConflict:true})}).where(eq(web.id,f.webId));assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,400);
 await f.db.update(web).set({crmEditSnapshot:'{}'}).where(eq(web.id,f.webId));f.env.sapoOrderPush='off';assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).data.code,'SAPO_PUSH_DISABLED');assert.equal(f.hooks.length,0);
});
test('unknown financials/SKU/tax or total discrepancies block export without guessing prices',async()=>{
 const f=await fixture();for(const patch of [{financialSnapshot:'{}'},{lines:JSON.stringify([{sku:'',quantity:2,total:200000,totalTax:16000}])},{lines:JSON.stringify([{sku:'00123',quantity:2,total:200000}])},{total:2265510}]){
 const [prior]=await f.db.select().from(web).where(eq(web.id,f.webId));await f.db.update(web).set(patch).where(eq(web.id,f.webId));
 const preview=await f.call('/sapo/preview?orderId='+encodeURIComponent(f.id),f.mgr);assert.equal(preview.status,200);assert.ok(preview.data.problems.length);assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,400);await f.db.update(web).set(prior!).where(eq(web.id,f.webId));
 }assert.equal(f.hooks.length,0);
});
test('failed hook preserves a durable unknown result; later explicit retry uses the same reference and refuses changed source data',async()=>{
 const f=await fixture();f.env.sapoWebhookFetch=async()=>{throw new Error('timeout');};assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,504);
 let o=(await f.list()).find((r:any)=>r.id===f.id);assert.equal(o.sapoPending,true);assert.equal(o.canCreateSapo,false);
 const [row]=await f.db.select().from(sapoOrderStatuses),meta=JSON.parse(row!.payloadJson!);await f.db.update(sapoOrderStatuses).set({payloadJson:JSON.stringify({...meta,requestedAt:'2000-01-01T00:00:00Z'})});
 f.env.sapoWebhookFetch=async(_url,init)=>{f.hooks.push({url:String(_url),body:JSON.parse(String(init!.body))});return Response.json({success:true});};
 o=(await f.list()).find((r:any)=>r.id===f.id);assert.equal(o.canCreateSapo,true);assert.equal(o.sapoRetry,true);assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).status,200);assert.equal(f.hooks[0]!.body.idempotency_key,'pos:WEB_LOCK_21569');
 await f.callback({quote_number:'WEB_LOCK_21569',status:'failed'});await f.db.update(web).set({total:300000}).where(eq(web.id,f.webId));assert.equal((await f.call(f.path+'/sapo',f.mgr,'POST',{})).data.code,'SAPO_WEB_CHANGED');
});
test('callback can finish before the webhook returns without being overwritten by pending/timeout state',async()=>{
 const f=await fixture();f.env.sapoWebhookFetch=async()=>{assert.equal((await f.callback({quote_number:'WEB_LOCK_21569',status:'created',sapo_order_id:9004})).status,200);throw new Error('response lost after callback');};
 const result=await f.call(f.path+'/sapo',f.mgr,'POST',{});assert.equal(result.status,200);assert.equal(result.data.sapo.status,'existing');assert.match(result.data.sapo.url,/9004$/);assert.equal((await f.db.select().from(sapoOrderStatuses))[0]!.status,'created');
});

test('an early failure callback is reported as failure rather than a queued/created order',async()=>{
 const f=await fixture();f.env.sapoWebhookFetch=async()=>{assert.equal((await f.callback({quote_number:'WEB_LOCK_21569',status:'failed'})).status,200);return Response.json({success:true});};
 const result=await f.call(f.path+'/sapo',f.mgr,'POST',{});assert.equal(result.status,502);assert.equal(result.data.code,'SAPO_WEBHOOK_FAILED');assert.equal((await f.db.select().from(sapoOrderStatuses))[0]!.status,'failed');assert.equal((await f.list()).find((r:any)=>r.id===f.id).canCreateSapo,true);
});
