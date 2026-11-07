import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {incomingShipments,incomingShipmentLines,suppliers,supplierReceipts,supplierReceiptLines,receiptJobs,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {receiptResult,receiptLink,dispatchReceiptJob,dispatchReceiptJobs} from '../../src/modules/suppliers/api/receipt-outbox.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {sha256Hex} from '../../src/modules/staff/domain/session.ts';
import {z} from 'zod';
// Contract V1 documented in docs/integrations/SUPPLIER-RECEIPT-OUTBOX.md; validate the actual wire payload.
const text=z.string().trim().min(1),percent=z.number().min(0).max(100);
const receiptContractV1=z.object({schema_version:z.literal(1),action:z.enum(['create_purchase_receipt','reconcile_existing']),source:z.literal('crm_supplier_receipt'),idempotency_key:text,
 crm_order:z.object({id:text,code:text,note:z.string()}),crm_receipt:z.object({id:text,code:text,received_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),note:z.string()}),
 supplier:z.object({id:text,name:text,tax_code:z.string()}),warehouse:z.object({name:text}),employee:z.object({id:text,name:text}),
 items:z.array(z.object({crm_line_id:text,sku:text,name:text,unit:text,good_quantity:z.number().positive(),unit_price:z.number().nonnegative(),purchase_discount_percent:percent,vat_percent:percent,note:z.string()})).min(1),
}).refine(p=>p.idempotency_key===p.crm_receipt.id);
const order='ea306b3a-da8d-4e31-aa36-7a0f1a8112c1',legacyId='4986310e-4ab7-40b6-bd02-90ed7db14391';
async function fixture(){
 const f=await setup(),now=new Date().toISOString(),calls:any[]=[];
 f.env.sapoGoodsReceiptWebhookUrl='https://n8nthai.moarchvn.com/webhook/sapo-goods-receipt-from-quote-web';
 f.env.sapoWebhookFetch=(async (_url:any,init:any)=>{calls.push(JSON.parse(init.body));return Response.json({ok:true});}) as typeof fetch;
 await f.db.insert(suppliers).values({id:'ml',name:'MINH LONG I',nameKey:'minhlong',taxCode:'370017620',createdBy:'mgr',createdAt:now,updatedAt:now});
 await f.db.insert(incomingShipments).values({id:order,ticketNumber:'DMH_20261022_004',source:'supplier-order',warehouse:'Kho POS',supplierId:'ml',supplierName:'MINH LONG I',approvalStatus:'approved',supplierStatus:'confirmed',createdBy:'mgr',createdAt:now,updatedAt:now,note:'Ghi chú đơn'});
 await f.db.insert(incomingShipmentLines).values({id:'line',shipmentId:order,lineNo:1,sku:'00123',name:'Ly sứ',unit:'cái',quantity:20,price:100000,purchaseDiscount:20,confirmedPurchaseDiscount:25,taxRate:8});
 const receive=async(qty=2)=>{const res=await f.call(`/purchase-orders/${order}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho POS',note:'Đợt nhận',lines:[{lineId:'line',goodQty:qty}]});assert.equal(res.status,201,JSON.stringify(res.data));return res.data.receiptId as string;};
 const row=async(id:string)=>(await f.db.select().from(supplierReceipts).where(eq(supplierReceipts.id,id)))[0]!;
 const job=async(id:string)=>(await f.db.select().from(receiptJobs).where(eq(receiptJobs.receiptId,id)))[0]!;
 const result=(id:string,extra:Record<string,unknown>={})=>({schema_version:1,action:'goods_receipt_result',idempotency_key:id,ok:true,crm_order_id:order,crm_receipt_id:id,sapo_purchase_order_id:'59291546',sapo_receipt_id:'58865407',sapo_receipt_code:'PCN10826',sapo_receipt_url:'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/59291546',...extra});
 const claim=async(id:string)=>{
  const res=await f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/goods-receipt-jobs/claim',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32),'content-type':'application/json'},body:JSON.stringify({crm_receipt_id:id})}),{...f.env,sapoSyncToken:'x'.repeat(32)});
  assert.equal(res.status,200);return (await res.json() as any).lease_token as string;
 };
 const complete=async(id:string,extra:Record<string,unknown>={})=>{
  const current=await job(id);if(!current)return receiptResult(f.db,result(id,extra));const token=current.leaseToken || (current.status==='done'?null:await claim(id));
  return receiptResult(f.db,result(id,{lease_token:token,...extra}));
 };
 return{...f,calls,receive,row,job,result,claim,complete};
}
test('Outbox: nhận từng phần, payload giá/CK/VAT chính xác, callback lặp, nhiều đợt, không đổi tồn từ callback',async()=>{
 const f=await fixture(),id=await f.receive();
 assert.equal(f.calls.length,1);const p=f.calls[0];
 assert.deepEqual(p,{schema_version:1,action:'create_purchase_receipt',source:'crm_supplier_receipt',idempotency_key:id,crm_order:{id:order,code:'DMH_20261022_004',note:'Ghi chú đơn'},crm_receipt:{id,code:(await f.row(id)).receiptNo,received_date:(await f.row(id)).receivedDate,note:'Đợt nhận'},supplier:{id:'ml',name:'MINH LONG I',tax_code:'370017620'},warehouse:{name:'Kho POS'},employee:{id:'mgr',name:'Tên mgr'},items:[{crm_line_id:'line',sku:'00123',name:'Ly sứ',unit:'cái',good_quantity:2,unit_price:100000,purchase_discount_percent:25,vat_percent:8,note:''}]});
 assert.equal((await f.row(id)).sapoStatus,'pending');assert.equal((await f.job(id)).status,'callback_pending');
 const before=await f.db.select().from(stockMoves);
 await f.complete(id);const saved=await f.row(id);assert.equal(saved.sapoReceiptId,'58865407');assert.ok(saved.sapoVerifiedAt);
 assert.equal((await f.complete(id)).duplicate,true);assert.equal((await f.row(id)).sapoVerifiedAt,saved.sapoVerifiedAt);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
 const view=(await f.call('/purchase-orders/'+order,f.mgr)).data.receipts[0];assert.equal(view.sapoReceiptUrl,f.result(id).sapo_receipt_url);
 await assert.rejects(()=>receiptResult(f.db,f.result(id,{sapo_receipt_id:'58865408'})),(e:any)=>e.status===409);assert.equal((await f.job(id)).status,'done');assert.equal((await f.row(id)).sapoReceiptId,'58865407');
 const id2=await f.receive(3);await assert.rejects(()=>f.complete(id2),(e:any)=>e.status===409);await f.complete(id2,{sapo_receipt_id:'58865409',sapo_receipt_code:'PCN10827'});
 assert.equal((await f.row(id)).sapoReceiptCode,'PCN10826');assert.equal((await f.row(id2)).sapoReceiptCode,'PCN10827');
});
test('Outbox: timeout giữ một phiếu/job; lỗi callback rồi thành công; claim nguyên tử, fencing và lease hết hạn',async()=>{
 const f=await fixture();f.env.sapoWebhookFetch=(async()=>{throw Error('timeout');}) as typeof fetch;
 const id=await f.receive();assert.equal((await f.job(id)).status,'failed');assert.equal((await f.db.select().from(supplierReceipts)).length,1);
 const hash=(await f.job(id)).payloadHash,stock=await f.db.select().from(stockMoves);
 f.env.sapoWebhookFetch=(async (_url:any,init:any)=>{f.calls.push(JSON.parse(init.body));return Response.json({ok:true});}) as typeof fetch;
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.emp,'POST',{})).status,403);
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.mgr,'POST',{})).status,200);
 assert.equal(f.calls[0].idempotency_key,id);assert.equal((await f.job(id)).payloadHash,hash);assert.equal((await f.job(id)).attempts,2);
 assert.equal((await f.db.select().from(supplierReceipts)).length,1);assert.deepEqual(await f.db.select().from(stockMoves),stock);
 await f.complete(id,{ok:false,error:'private-token'});assert.equal((await f.job(id)).status,'needs_review');assert.ok(!(await f.row(id)).sapoNote.includes('private-token'));
 await f.complete(id);assert.equal((await f.job(id)).status,'done');
 const id2=await f.receive();
 const claim=()=>f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/goods-receipt-jobs/claim',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32),'content-type':'application/json'},body:JSON.stringify({crm_receipt_id:id2})}),{...f.env,sapoSyncToken:'x'.repeat(32)});
 const both=await Promise.all([claim(),claim()]);assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
 const token=(await f.job(id2)).leaseToken!;
 await assert.rejects(()=>receiptResult(f.db,f.result(id2,{sapo_receipt_id:'58865410'})),(e:any)=>e.status===409);
 await f.db.update(receiptJobs).set({leaseUntil:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id2));
 assert.equal((await claim()).status,409);assert.equal((await f.job(id2)).status,'needs_review');
 // Callback xác minh từ execution đã claim vẫn nhận được nếu không có yêu cầu đối soát mới.
 await f.complete(id2,{sapo_receipt_id:'58865410',lease_token:token});
 assert.equal((await f.row(id2)).sapoReceiptId,'58865410');
});
test('Outbox: thiếu giá/SKU/NCC không dispatch; kho sai bị chặn, chỉ số lượng đạt và CK fallback',async()=>{
 const f=await fixture();
 await f.db.update(incomingShipmentLines).set({price:null}).where(eq(incomingShipmentLines.id,'line'));
 let id=await f.receive();assert.equal(f.calls.length,0);assert.equal((await f.job(id)).status,'needs_review');assert.match((await f.job(id)).lastError,/unit_price/);
 await f.db.update(incomingShipmentLines).set({price:100000,sku:'',confirmedPurchaseDiscount:null}).where(eq(incomingShipmentLines.id,'line'));
 id=await f.receive();assert.equal(f.calls.length,0);assert.match((await f.job(id)).lastError,/sku/);
 await f.db.update(incomingShipmentLines).set({sku:'00123'}).where(eq(incomingShipmentLines.id,'line'));
 const noSupplier=await f.call('/purchase-orders',f.mgr,'POST',{orders:[{supplierId:'',warehouse:'Kho POS',lines:[{sku:'00123',name:'Ly',unit:'cái',quantity:1,sources:[]}]}]});assert.equal(noSupplier.status,400);assert.equal(f.calls.length,0);
 const bad=await f.call(`/purchase-orders/${order}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Sai kho',lines:[{lineId:'line',goodQty:1}]});assert.equal(bad.status,400);
 const r=await f.call(`/purchase-orders/${order}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho POS',lines:[{lineId:'line',goodQty:1,damagedQty:2}],photos:['data:image/jpeg;base64,/9j/4AAA']});assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal(f.calls[0].items[0].good_quantity,1);assert.equal(f.calls[0].items[0].purchase_discount_percent,20);assert.equal(f.calls[0].items[0].damaged_quantity,undefined);
});
test('Đối soát: Manager + expected + lý do; done thủ công không tự vượt 409; chỉ callback đúng yêu cầu mới sửa liên kết',async()=>{
 const f=await fixture(),now=new Date().toISOString();
 await f.db.insert(supplierReceipts).values({id:legacyId,receiptNo:'PNH_20261022_004',shipmentId:order,receivedDate:'2026-10-22',receivedBy:'mgr',warehouse:'KHO VIGIFTS',clientKey:'legacy-unique',sapoStatus:'done',sapoReceiptCode:'PNH_20261022_004',createdAt:now});
 await assert.rejects(()=>f.complete(legacyId),(e:any)=>e.status===409);
 const expected=receiptLink(await f.row(legacyId)),path=`/supplier-receipts/${legacyId}/reconcile-sapo`;
 assert.equal((await f.call(path,f.emp,'POST',{expected,reason:'Đối soát mã nhập tay'})).status,403);
 assert.equal((await f.call(path,f.mgr,'POST',{expected:{},reason:'Đối soát'})).status,409);
 const res=await f.call(path,f.mgr,'POST',{expected,reason:'Đối soát mã nhập tay'});assert.equal(res.status,200,JSON.stringify(res.data));
 assert.equal(f.calls[0].warehouse.name,'KHO VIGIFTS');assert.equal(f.calls[0].supplier.name,'MINH LONG I');
 assert.equal(f.calls[0].action,'reconcile_existing');assert.equal(f.calls[0].crm_receipt_id,legacyId);assert.equal((await f.row(legacyId)).sapoReceiptCode,'PNH_20261022_004');
 await assert.rejects(()=>f.complete(legacyId),(e:any)=>e.status===409);
 await f.db.update(supplierReceipts).set({sapoUpdatedAt:now}).where(eq(supplierReceipts.id,legacyId));
 await assert.rejects(()=>f.complete(legacyId,{reconciliation_id:res.data.reconciliationId}),(e:any)=>e.status===409);
 await f.db.update(receiptJobs).set({leaseUntil:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,legacyId));
 const next=await f.call(path,f.mgr,'POST',{expected:receiptLink(await f.row(legacyId)),reason:'Đọc lại bản hiện tại để đối soát'});assert.equal(next.status,200);
 await assert.rejects(()=>f.complete(legacyId,{reconciliation_id:res.data.reconciliationId}),(e:any)=>e.status===409);
 await f.complete(legacyId,{reconciliation_id:next.data.reconciliationId});
 assert.equal((await f.row(legacyId)).sapoReceiptCode,'PCN10826');assert.equal((await f.row(legacyId)).sapoReceiptId,'58865407');
 assert.equal((await f.db.select().from(supplierOrderEvents)).filter(e=>e.action==='sapo_reconcile').length,1);
 assert.equal((await f.db.select().from(stockMoves)).filter(m=>m.refId===legacyId).length,0);
 assert.equal((await f.call(`/supplier-receipts/${legacyId}/sapo`,f.mgr,'PUT',{status:'done',code:'WRONG'})).status,409);
});


test('Callback HTTP: xác thực bắt buộc, schema/link đầy đủ; callback nhanh không bị dispatcher ghi đè',async()=>{
 const f=await fixture();let id='';
 f.env.sapoWebhookFetch=(async (_url:any,init:any)=>{
  const payload=JSON.parse(init.body);id=payload.crm_receipt.id;
  await f.complete(id);return Response.json({ok:true});
 }) as typeof fetch;
 await f.receive();assert.equal((await f.job(id)).status,'done');assert.equal((await f.row(id)).sapoStatus,'done');
 const call=async(body:any,auth=true)=>f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/goods-receipt-result',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+'x'.repeat(32)}:{})},body:JSON.stringify(body)}),{...f.env,sapoSyncToken:'x'.repeat(32)});
 assert.equal((await call(f.result(id),false)).status,401);
 assert.equal((await call(f.result(id))).status,200);
 assert.equal((await call(f.result(id,{sapo_receipt_url:''}))).status,400);
 assert.equal((await call(f.result(id,{sapo_receipt_url:'https://evil.test/admin/purchase_orders/59291546'}))).status,400);
 assert.equal((await call(f.result(id,{idempotency_key:'OTHER'}))).status,400);
 assert.equal((await call(f.result(id,{sapo_purchase_order_id:'OTHER'}))).status,400);
 assert.equal((await call(f.result(id,{crm_order_id:'OTHER'}))).status,409);
});


test('Callback lỗi tới trước HTTP 2xx: giữ needs_review, dispatcher không đổi lại pending',async()=>{
 const f=await fixture();let id='';
 f.env.sapoWebhookFetch=(async (_url:any,init:any)=>{
  id=JSON.parse(init.body).crm_receipt.id;
  await f.complete(id,{ok:false,error:'Không khớp kho trên Sapo'});
  return Response.json({ok:true});
 }) as typeof fetch;
 await f.receive();assert.equal((await f.job(id)).status,'needs_review');assert.equal((await f.row(id)).sapoStatus,'failed');
 assert.equal((await f.job(id)).dispatchToken,null);
 await f.complete(id);assert.equal((await f.job(id)).status,'done');
});

for(const [line,catalog,expected] of [['  ',' Bộ ','Bộ'],['','  ','Cái'],[' Hộp ','Bộ','Hộp']])test(`Contract V1: unit dòng ${JSON.stringify(line)}, catalog ${JSON.stringify(catalog)} → ${expected}`,async()=>{
 const f=await fixture();await f.db.update(incomingShipmentLines).set({unit:line}).where(eq(incomingShipmentLines.id,'line'));
 await f.db.update(products).set({unit:catalog}).where(eq(products.sku,'00123'));
 await f.db.insert(products).values({sku:'00123-near',name:'Không được khớp gần',unit:'Sai',updatedAt:new Date().toISOString()});
 const id=await f.receive(),payload=f.calls[0];
 assert.equal(payload.items[0].unit,expected);receiptContractV1.parse(payload);
 assert.equal(JSON.parse((await f.job(id)).payload).items[0].unit,expected);
 const rec=await f.row(id),before=await f.db.select().from(stockMoves);
 assert.equal((await f.call(`/supplier-receipts/${id}/reconcile-sapo`,f.mgr,'POST',{reason:'Đối chiếu phiếu đã có',expected:receiptLink(rec)})).status,200);
 assert.equal(f.calls[1].action,'reconcile_existing');assert.equal(f.calls[1].items[0].unit,expected);receiptContractV1.parse(f.calls[1]);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
});

test('Retry snapshot cũ: chỉ sửa unit/hash, giữ nguyên key; Sapo đã có chỉ callback, không tạo hoặc cộng tồn lại',async()=>{
 const f=await fixture(),original=await f.receive(),id='c9a0ef98-c742-42de-b00c-629702dab458',now=new Date().toISOString();
 const base=await f.row(original),payload=structuredClone(f.calls[0]);payload.idempotency_key=id;payload.crm_receipt.id=id;payload.items[0].unit='';
 await f.db.insert(supplierReceipts).values({...base,id,clientKey:'legacy-unit-mock',receiptNo:'PNH-UNIT-MOCK',sapoStatus:'failed'});
 const snapshot=JSON.stringify(payload);
 await f.db.insert(receiptJobs).values({receiptId:id,action:'create_purchase_receipt',status:'processing',payload:snapshot,payloadHash:sha256Hex(snapshot),leaseToken:'active-worker',leaseUntil:new Date(Date.now()+60_000).toISOString(),createdAt:now,updatedAt:now});
 await f.db.update(products).set({unit:' Bộ '}).where(eq(products.sku,'00123'));
 await f.db.update(incomingShipmentLines).set({price:1,purchaseDiscount:99,confirmedPurchaseDiscount:99,taxRate:0,quantity:99,unit:'Không dùng lại dòng đơn'}).where(eq(incomingShipmentLines.id,'line'));
 assert.equal((await dispatchReceiptJob(f.env,id)).skipped,true);assert.equal((await f.job(id)).payload,snapshot,'không sửa snapshot worker đang dùng');
 await f.db.update(receiptJobs).set({status:'failed',leaseToken:null,leaseUntil:null}).where(eq(receiptJobs.receiptId,id));
 const before=await f.db.select().from(stockMoves),count=(await f.db.select().from(supplierReceipts)).length;
 let lookups=0,created=0;const sapo=new Set([id]);
 f.env.sapoWebhookFetch=(async(_url:any,init:any)=>{
  const wire=JSON.parse(init.body);receiptContractV1.parse(wire);assert.equal(wire.idempotency_key,id);assert.equal(wire.crm_receipt.id,id);
  assert.deepEqual(wire,{...payload,items:payload.items.map((i:any)=>({...i,unit:'Bộ'}))});
  lookups++;if(!sapo.has(wire.idempotency_key)){created++;sapo.add(wire.idempotency_key);}
  await f.complete(id);return Response.json({ok:true});
 }) as typeof fetch;
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.mgr,'POST',{})).status,200);
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.mgr,'POST',{})).status,409);
 const job=await f.job(id);assert.equal(job.payloadHash,sha256Hex(job.payload));assert.equal(job.status,'done');
 assert.equal(lookups,1);assert.equal(created,0);assert.equal((await f.db.select().from(supplierReceipts)).length,count);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
});

test('Claim snapshot cũ chuẩn hoá unit trước khi trao worker; key sai hoặc đã có liên kết Sapo không được tạo lại',async()=>{
 const f=await fixture(),id=await f.receive(),payload=structuredClone(f.calls[0]);payload.items[0].unit='';
 await f.db.update(products).set({unit:''}).where(eq(products.sku,'00123'));
 await f.db.update(receiptJobs).set({payload:JSON.stringify(payload)}).where(eq(receiptJobs.receiptId,id));
 const claim=()=>f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/goods-receipt-jobs/claim',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32),'content-type':'application/json'},body:JSON.stringify({crm_receipt_id:id})}),{...f.env,sapoSyncToken:'x'.repeat(32)});
 const before=await f.db.select().from(stockMoves),res=await claim();assert.equal(res.status,200);const body=await res.json() as any;
 assert.equal(body.payload.items[0].unit,'Cái');receiptContractV1.parse(body.payload);assert.equal((await claim()).status,409);
 const job=await f.job(id);assert.equal(job.payloadHash,sha256Hex(job.payload));
 await f.db.update(receiptJobs).set({status:'failed',leaseToken:null,leaseUntil:null,payload:JSON.stringify({...payload,idempotency_key:'wrong'})}).where(eq(receiptJobs.receiptId,id));
 await assert.rejects(()=>dispatchReceiptJob(f.env,id),(e:any)=>e.status===409&&e.code==='RECEIPT_NEEDS_REVIEW');
 await f.db.update(supplierReceipts).set({sapoReceiptId:'58865407',sapoStatus:'failed'}).where(eq(supplierReceipts.id,id));
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.mgr,'POST',{})).status,409);assert.equal((await dispatchReceiptJob(f.env,id)).skipped,true);assert.equal((await claim()).status,409);
 assert.equal(f.calls.length,1);assert.deepEqual(await f.db.select().from(stockMoves),before);
});

test('503 durable retry nền; 2xx chưa done; job đã claim/timeout chỉ review, không giao lại',async()=>{
 const f=await fixture();f.env.sapoWebhookFetch=(async()=>new Response('Unavailable',{status:503})) as typeof fetch;
 const id=await f.receive(),hash=(await f.job(id)).payloadHash;
 assert.equal((await f.job(id)).status,'failed');assert.match((await f.row(id)).sapoNote,/HTTP 503/);
 assert.equal((await dispatchReceiptJobs(f.env)).results.length,0,'không retry dồn trong 5 phút');
 await f.db.update(receiptJobs).set({updatedAt:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id));
 f.env.sapoWebhookFetch=(async(_u:any,i:any)=>{f.calls.push(JSON.parse(i.body));return Response.json({ok:true});}) as typeof fetch;
 const batch=await dispatchReceiptJobs(f.env);assert.equal(batch.results[0]?.sent,true);
 assert.equal((await f.job(id)).status,'callback_pending');assert.equal((await f.job(id)).payloadHash,hash);
 assert.equal(f.calls[0].idempotency_key,id);assert.equal((await f.job(id)).attempts,2);
 await assert.rejects(()=>receiptResult(f.db,f.result(id)),(e:any)=>e.status===409,'callback chưa claim bị từ chối');
 const token=await f.claim(id);assert.ok(token);
 await f.db.update(receiptJobs).set({leaseUntil:'2000-01-01T00:00:00Z',updatedAt:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id));
 await dispatchReceiptJobs(f.env);assert.equal((await f.job(id)).status,'needs_review');assert.equal(f.calls.length,1);
 assert.equal((await dispatchReceiptJob(f.env,id)).skipped,true);
 assert.equal((await f.call(`/supplier-receipts/${id}/retry-sapo`,f.mgr,'POST',{})).status,409);
});

test('Retry nền cứu HTTP accepted bị mất consumer; snapshot đối soát giữ giá lúc nhận, không lấy giá hiện tại',async()=>{
 const f=await fixture(),id=await f.receive(),original=JSON.parse((await f.job(id)).payload);
 await f.db.update(receiptJobs).set({updatedAt:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id));
 await Promise.all([dispatchReceiptJobs(f.env),dispatchReceiptJobs(f.env)]);
 assert.equal(f.calls.length,2,'hai dispatcher đồng thời chỉ giao thêm một lần');
 assert.equal((await f.job(id)).status,'callback_pending');
 await f.db.update(incomingShipmentLines).set({price:999,purchaseDiscount:99,confirmedPurchaseDiscount:99,taxRate:0}).where(eq(incomingShipmentLines.id,'line'));
 const res=await f.call(`/supplier-receipts/${id}/reconcile-sapo`,f.mgr,'POST',{expected:receiptLink(await f.row(id)),reason:'Tra cứu phiếu đúng giá lúc nhận'});
 assert.equal(res.status,200);const p=f.calls.at(-1);
 assert.equal(p.action,'reconcile_existing');assert.deepEqual(p.items,original.items);
 assert.equal(p.idempotency_key,id);
});

test('Batch không bị một payload lỗi chặn; dispatcher không nhặt lại lease thực thi cũ',async()=>{
 const f=await fixture(),bad=await f.receive(),good=await f.receive();
 await f.db.update(receiptJobs).set({status:'queued',payload:'{broken',updatedAt:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,bad));
 await f.db.update(receiptJobs).set({status:'queued',updatedAt:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,good));
 const result=await dispatchReceiptJobs(f.env);
 assert.equal(result.results.length,2);assert.equal((await f.job(bad)).status,'needs_review');assert.equal((await f.job(good)).status,'callback_pending');
 await f.db.update(receiptJobs).set({status:'failed',leaseToken:'old-worker',leaseUntil:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,good));
 assert.equal((await dispatchReceiptJob(f.env,good)).skipped,true);
});

test('Lỗi ghi outbox rollback toàn bộ phiếu/dòng/ledger; không gửi webhook trước commit',async()=>{
 const f=await fixture(),before=await f.db.select().from(stockMoves);
 await f.db.execute(sql`create function reject_receipt_job_test() returns trigger language plpgsql as $$ begin raise exception 'test outbox unavailable'; end $$`);
 await f.db.execute(sql`create trigger reject_receipt_job_test before insert on supplier_receipt_jobs for each row execute function reject_receipt_job_test()`);
 const res=await f.call(`/purchase-orders/${order}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho POS',lines:[{lineId:'line',goodQty:2}]});
 assert.equal(res.status,500);assert.equal(f.calls.length,0);
 assert.deepEqual(await f.db.select().from(supplierReceipts),[]);assert.deepEqual(await f.db.select().from(supplierReceiptLines),[]);
 assert.deepEqual(await f.db.select().from(receiptJobs),[]);assert.deepEqual(await f.db.select().from(stockMoves),before);
 assert.equal((await f.db.select().from(supplierOrderEvents)).filter(e=>e.action==='receive').length,0);
});

test('Manager undo requires explicit no-Sapo resolution, expired worker lease and unchanged snapshot; reverses once and rejects late callback',async()=>{
 const f=await fixture(),id=await f.receive(),token=await f.claim(id);
 await f.db.update(receiptJobs).set({status:'needs_review'}).where(eq(receiptJobs.receiptId,id));
 const body=async()=>({reason:'Nhập trùng đã kiểm tra Sapo',confirmNoSapo:true,expected:{sapoUpdatedAt:(await f.row(id)).sapoUpdatedAt??null,jobUpdatedAt:(await f.job(id)).updatedAt}});
 const cancel=(b:any)=>f.call('/supplier-receipts/'+id+'/cancel',f.mgr,'POST',b);
 assert.equal((await cancel(await body())).status,409,'cannot override a still-live lease');
 const stale=await body();await f.db.update(receiptJobs).set({leaseUntil:'2000-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id));
 assert.equal((await cancel(stale)).status,409,'job changed since preview');
 assert.equal((await cancel({...await body(),confirmNoSapo:false})).status,409,'no implicit operator attestation');
 const before=await f.db.select().from(stockMoves),ok=await cancel(await body());assert.equal(ok.status,200,JSON.stringify(ok.data));assert.ok((await f.row(id)).cancelledAt);assert.equal((await f.job(id)).leaseToken,null);assert.equal((await f.job(id)).status,'needs_review');
 assert.equal((await f.db.select().from(stockMoves)).length,before.length+1);assert.equal((await f.db.select().from(stockMoves)).filter(m=>m.refId===id&&m.kind==='reverse')[0]?.qty,-2);
 assert.equal((await cancel(await body())).status,200);assert.equal((await f.db.select().from(stockMoves)).length,before.length+1);
 await assert.rejects(receiptResult(f.db,f.result(id,{lease_token:token})),/đã huỷ/);
});
