import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {incomingShipments,incomingShipmentLines,suppliers,supplierReceipts,receiptJobs,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {receiptResult,receiptLink,dispatchReceiptJob} from '../../src/modules/suppliers/api/receipt-outbox.ts';
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
 return{...f,calls,receive,row,job,result};
}
test('Outbox: nhận từng phần, payload giá/CK/VAT chính xác, callback lặp, nhiều đợt, không đổi tồn từ callback',async()=>{
 const f=await fixture(),id=await f.receive();
 assert.equal(f.calls.length,1);const p=f.calls[0];
 assert.deepEqual(p,{schema_version:1,action:'create_purchase_receipt',source:'crm_supplier_receipt',idempotency_key:id,crm_order:{id:order,code:'DMH_20261022_004',note:'Ghi chú đơn'},crm_receipt:{id,code:(await f.row(id)).receiptNo,received_date:(await f.row(id)).receivedDate,note:'Đợt nhận'},supplier:{id:'ml',name:'MINH LONG I',tax_code:'370017620'},warehouse:{name:'Kho POS'},employee:{id:'mgr',name:'Tên mgr'},items:[{crm_line_id:'line',sku:'00123',name:'Ly sứ',unit:'cái',good_quantity:2,unit_price:100000,purchase_discount_percent:25,vat_percent:8,note:''}]});
 assert.equal((await f.row(id)).sapoStatus,'pending');assert.equal((await f.job(id)).status,'callback_pending');
 const before=await f.db.select().from(stockMoves);
 await receiptResult(f.db,f.result(id));const saved=await f.row(id);assert.equal(saved.sapoReceiptId,'58865407');assert.ok(saved.sapoVerifiedAt);
 assert.equal((await receiptResult(f.db,f.result(id))).duplicate,true);assert.equal((await f.row(id)).sapoVerifiedAt,saved.sapoVerifiedAt);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
 const view=(await f.call('/purchase-orders/'+order,f.mgr)).data.receipts[0];assert.equal(view.sapoReceiptUrl,f.result(id).sapo_receipt_url);
 await assert.rejects(()=>receiptResult(f.db,f.result(id,{sapo_receipt_id:'58865408'})),(e:any)=>e.status===409);assert.equal((await f.job(id)).status,'needs_review');assert.equal((await f.row(id)).sapoReceiptId,'58865407');
 const id2=await f.receive(3);await assert.rejects(()=>receiptResult(f.db,f.result(id2)),(e:any)=>e.status===409);await receiptResult(f.db,f.result(id2,{sapo_receipt_id:'58865409',sapo_receipt_code:'PCN10827'}));
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
 await receiptResult(f.db,f.result(id,{ok:false,error:'private-token'}));assert.equal((await f.job(id)).status,'failed');assert.ok(!(await f.row(id)).sapoNote.includes('private-token'));
 await receiptResult(f.db,f.result(id));assert.equal((await f.job(id)).status,'done');
 const id2=await f.receive();
 const claim=()=>f.router.handle(new Request('https://trial.test/api/staff/integrations/sapo/goods-receipt-jobs/claim',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32),'content-type':'application/json'},body:JSON.stringify({crm_receipt_id:id2})}),{...f.env,sapoSyncToken:'x'.repeat(32)});
 const both=await Promise.all([claim(),claim()]);assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
 const token=(await f.job(id2)).leaseToken!;
 await assert.rejects(()=>receiptResult(f.db,f.result(id2,{sapo_receipt_id:'58865410'})),(e:any)=>e.status===409);
 await f.db.update(receiptJobs).set({leaseUntil:'2000-01-01T00:00:00Z'}).where(eq(receiptJobs.receiptId,id2));
 assert.equal((await claim()).status,409);assert.equal((await f.job(id2)).status,'needs_review');
 // Callback xác minh từ execution đã claim vẫn nhận được nếu không có yêu cầu đối soát mới.
 await receiptResult(f.db,f.result(id2,{sapo_receipt_id:'58865410',lease_token:token}));
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
 const r=await f.call(`/purchase-orders/${order}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho POS',lines:[{lineId:'line',goodQty:1,damagedQty:2}],photos:['data:image/jpeg;base64,YW5o']});assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal(f.calls[0].items[0].good_quantity,1);assert.equal(f.calls[0].items[0].purchase_discount_percent,20);assert.equal(f.calls[0].items[0].damaged_quantity,undefined);
});
test('Đối soát: Manager + expected + lý do; done thủ công không tự vượt 409; chỉ callback đúng yêu cầu mới sửa liên kết',async()=>{
 const f=await fixture(),now=new Date().toISOString();
 await f.db.insert(supplierReceipts).values({id:legacyId,receiptNo:'PNH_20261022_004',shipmentId:order,receivedDate:'2026-10-22',receivedBy:'mgr',warehouse:'KHO VIGIFTS',clientKey:'legacy-unique',sapoStatus:'done',sapoReceiptCode:'PNH_20261022_004',createdAt:now});
 await assert.rejects(()=>receiptResult(f.db,f.result(legacyId)),(e:any)=>e.status===409);
 const expected=receiptLink(await f.row(legacyId)),path=`/supplier-receipts/${legacyId}/reconcile-sapo`;
 assert.equal((await f.call(path,f.emp,'POST',{expected,reason:'Đối soát mã nhập tay'})).status,403);
 assert.equal((await f.call(path,f.mgr,'POST',{expected:{},reason:'Đối soát'})).status,409);
 const res=await f.call(path,f.mgr,'POST',{expected,reason:'Đối soát mã nhập tay'});assert.equal(res.status,200,JSON.stringify(res.data));
 assert.equal(f.calls[0].warehouse.name,'KHO VIGIFTS');assert.equal(f.calls[0].supplier.name,'MINH LONG I');
 assert.equal(f.calls[0].action,'reconcile_existing');assert.equal(f.calls[0].crm_receipt_id,legacyId);assert.equal((await f.row(legacyId)).sapoReceiptCode,'PNH_20261022_004');
 await assert.rejects(()=>receiptResult(f.db,f.result(legacyId)),(e:any)=>e.status===409);
 await f.db.update(supplierReceipts).set({sapoUpdatedAt:now}).where(eq(supplierReceipts.id,legacyId));
 await assert.rejects(()=>receiptResult(f.db,f.result(legacyId,{reconciliation_id:res.data.reconciliationId})),(e:any)=>e.status===409);
 const next=await f.call(path,f.mgr,'POST',{expected:receiptLink(await f.row(legacyId)),reason:'Đọc lại bản hiện tại để đối soát'});assert.equal(next.status,200);
 await assert.rejects(()=>receiptResult(f.db,f.result(legacyId,{reconciliation_id:res.data.reconciliationId})),(e:any)=>e.status===409);
 await receiptResult(f.db,f.result(legacyId,{reconciliation_id:next.data.reconciliationId}));
 assert.equal((await f.row(legacyId)).sapoReceiptCode,'PCN10826');assert.equal((await f.row(legacyId)).sapoReceiptId,'58865407');
 assert.equal((await f.db.select().from(supplierOrderEvents)).filter(e=>e.action==='sapo_reconcile').length,1);
 assert.equal((await f.db.select().from(stockMoves)).filter(m=>m.refId===legacyId).length,0);
 assert.equal((await f.call(`/supplier-receipts/${legacyId}/sapo`,f.mgr,'PUT',{status:'done',code:'WRONG'})).status,409);
});


test('Callback HTTP: xác thực bắt buộc, schema/link đầy đủ; callback nhanh không bị dispatcher ghi đè',async()=>{
 const f=await fixture();let id='';
 f.env.sapoWebhookFetch=(async (_url:any,init:any)=>{
  const payload=JSON.parse(init.body);id=payload.crm_receipt.id;
  await receiptResult(f.db,f.result(id));return Response.json({ok:true});
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
