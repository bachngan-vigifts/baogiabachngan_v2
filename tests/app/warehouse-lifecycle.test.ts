import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {salesOrderLines,salesOrders,orderProgressMarks,deliveries} from '../../src/modules/sales/schema.ts';
import {refreshOrderStatus} from '../../src/modules/sales/api/routes.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const photo='data:image/jpeg;base64,'+'A'.repeat(200),sku='031106000';
async function fixture(){
 const f=await setupEarly(),now=new Date().toISOString(),router=createAppRouter(),outbound:any[]=[];
 await f.db.insert(products).values({sku,name:'Bộ trà kiểm thử',unit:'Bộ',updatedAt:now});
 await f.db.insert(warehouses).values([{id:'vig',name:'KHO VIGIFTS',kind:'stock'},{id:'other',name:'Kho khác',kind:'stock'}]);
 await postMoves(f.db,'mgr',[{sku:'BOOT',warehouseId:'vig',qty:1,kind:'opening',refType:'opening',refId:'opening'},{sku,warehouseId:'other',qty:10,kind:'opening',refType:'opening',refId:'opening'}]);
 await f.db.update(incomingShipmentLines).set({quantity:5,price:1000,purchaseDiscount:0,confirmedPurchaseDiscount:0,taxRate:8}).where(eq(incomingShipmentLines.id,'line-a1'));
 const env:StaffEnv={db:f.db,passwordIterations:1000,sapoOrderPush:'off',sapoSyncToken:'integration-test-only-sync-token-32-chars',sapoGoodsReceiptWebhookUrl:'https://n8nthai.moarchvn.com/webhook/test-only',
  sapoWebhookFetch:async(_url,init)=>{outbound.push(JSON.parse(String(init?.body)));return new Response('{}',{status:202});}};
 const call=async(path:string,cookie=f.cookies.mgr,method='GET',body?:unknown)=>{
  const headers:Record<string,string>={origin:'https://trial.test','content-type':'application/json',cookie:cookie||''};if(path.startsWith('/integrations/'))headers['x-sapo-sync-token']=env.sapoSyncToken!;
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json() as any};};
 const q=ok(await call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'FULL-'+crypto.randomUUID(),customer:'Khách kiểm thử',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty:2,price:2000},{sku,name:'Bộ trà',unit:'Bộ',qty:3,price:2000}]}),201);
 ok(await call('/quotes/'+q.id+'/approve',f.cookies.mgr,'POST',{revision:1}));
 const order=ok(await call('/orders',f.cookies.emp,'POST',{quoteId:q.id,warehouseId:'vig'}),201);
 const lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,order.id)).orderBy(salesOrderLines.lineNo);
 ok(await call(`/orders/${order.id}/status`,f.cookies.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
 const trip=ok(await call('/deliveries',f.cookies.emp,'POST',{orderId:order.id,plannedDate:'2026-10-24',lines:lines.map(l=>({orderLineId:l.id,qty:l.qty}))}),201);
 const balance=async(wh='vig')=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,sku),eq(stockBalances.warehouseId,wh))))[0]?.qty??0;
 const pack=async(index:number,source='warehouse')=>{
  const p=ok(await call(`/orders/${order.id}/packing`,f.cookies.emp,'POST',{allocations:[{orderLineId:lines[index]!.id,qty:lines[index]!.qty,source,sourceNote:source==='warehouse'?'':'NCC giao trực tiếp'}]}),201).slips[0];
  ok(await call('/packing/'+p.id+'/send',f.cookies.emp,'POST',{}));return p;};
 return {...f,call,order,lines,trip,balance,pack,outbound};
}
for(const early of [false,true])test(`${early?'lấy trước đã đồng ý':'nhận NCC thường'} → duyệt không trừ → xuất 2+3 đúng kho → giao không trừ lần nữa; callback không cộng lại`,async()=>{
 const f=await fixture(),c=f.cookies;
 assert.equal(await f.balance(),0,'duyệt đơn trước khi hàng về không trừ kho');
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'})).data.code,'STOCK_NOT_PACKED');
 let earlyRequestId:string|undefined;
 if(early){const r=ok(await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-24',scope:{supplierId:'a'},lines:[{sku,quantity:5}]}),201);
  const submitted=ok(await f.call('/purchase-early-requests/'+r.id+'/submit',c.mgr,'POST',{revision:r.request.revision}));earlyRequestId=r.id;
  ok(await f.call('/purchase-early-request-lines/'+submitted.request.lines[0].id+'/manager-confirm',c.mgr,'POST',{supplierId:'a'}));}
 const body={clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',receivedDate:'2026-10-24',lines:[{lineId:'line-a1',goodQty:5,damagedQty:0}],...(earlyRequestId?{earlyRequestId}:{})};
 const receipt=ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',body),201);assert.equal(await f.balance(),5);assert.equal(f.outbound.length,1);
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',body));assert.equal(await f.balance(),5);assert.equal(f.outbound.length,1);
 const claim=ok(await f.call('/integrations/sapo/goods-receipt-jobs/claim','', 'POST',{crm_receipt_id:receipt.receiptId}));
 const result={schema_version:1,action:'goods_receipt_result',idempotency_key:receipt.receiptId,crm_order_id:'a1',crm_receipt_id:receipt.receiptId,lease_token:claim.lease_token,ok:true,sapo_purchase_order_id:'1234',sapo_receipt_id:'5678',sapo_receipt_code:'PCN-TEST',sapo_receipt_url:'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/1234'};
 ok(await f.call('/integrations/sapo/goods-receipt-result','', 'POST',result));ok(await f.call('/integrations/sapo/goods-receipt-result','', 'POST',result));assert.equal(await f.balance(),5);
 const first=await f.pack(0);ok(await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),3);
 assert.equal(ok(await f.call('/orders/'+f.order.id,c.emp)).progress.stages.find((s:any)=>s.key==='export').done,false,'xuất một dòng SKU lặp không hoàn thành cả đơn');
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'})).data.code,'STOCK_NOT_PACKED');
 assert.equal((await f.call(`/orders/${f.order.id}/progress`,c.mgr,'POST',{stage:'all'})).data.code,'STOCK_NOT_PACKED');
 const second=await f.pack(1);ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),0);
 ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}),409);assert.equal(await f.balance(),0);
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'}));ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'}));assert.equal(await f.balance(),0);assert.equal(await f.balance('other'),10);
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'}),409);ok(await f.call(`/orders/${f.order.id}/status`,c.mgr,'PUT',{status:'cancelled'}),409);assert.equal(await f.balance(),0);
 const report=ok(await f.call('/warehouse-workflow-audit'));assert.equal(report.balances.total,0);assert.equal(report.receipts.total,0);assert.equal(report.dispatchedOrders.rows.some((r:any)=>r.orderId===f.order.id),false);
});
test('đơn cũ không kho/không kế hoạch không được giao thiếu xuất; tiến trình cũ không giả lập xuất; báo cáo chỉ đọc',async()=>{
 const f=await fixture(),c=f.cookies;
 const storeSlip=await f.pack(0,'store');
 const storeResult=await f.call('/packing/'+storeSlip.id+'/confirm',c.kho,'POST',{warehouseId:'other',photos:[photo]});
 assert.equal(storeResult.data.code,'TRANSFER_REQUIRED');assert.equal(await f.balance('other'),10);
 await f.db.update(salesOrders).set({warehouseId:null,status:'confirmed'}).where(eq(salesOrders.id,f.order.id));
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'})).data.code,'STOCK_NOT_PACKED');
 assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id,f.trip.id)))[0]!.status,'planned');
 await f.db.insert(orderProgressMarks).values({orderId:f.order.id,stage:'export',source:'manual',markedBy:'mgr',markedAt:new Date().toISOString()});
 assert.equal(ok(await f.call('/orders/'+f.order.id,c.emp)).progress.stages.find((s:any)=>s.key==='export').done,false);
 await f.db.update(salesOrders).set({status:'delivered'}).where(eq(salesOrders.id,f.order.id));
 const before=await f.db.select().from(stockMoves);const report=ok(await f.call('/warehouse-workflow-audit'));
 assert.equal(report.readOnly,true);const missing=report.dispatchedOrders.rows.find((r:any)=>r.orderId===f.order.id);assert.equal(missing.warehouseMissing,true);assert.equal(missing.lines.reduce((n:number,l:any)=>n+l.missing,0),5);
 assert.deepEqual(await f.db.select().from(stockMoves),before);ok(await f.call('/warehouse-workflow-audit',c.emp),403);
 await f.db.update(stockBalances).set({qty:99}).where(and(eq(stockBalances.sku,sku),eq(stockBalances.warehouseId,'other')));
 const mismatch=ok(await f.call('/warehouse-workflow-audit'));
 assert.equal(mismatch.balances.total,1);assert.equal(mismatch.balances.rows[0].balance_qty,99);assert.equal(mismatch.balances.rows[0].ledger_qty,10);
 const beyond=ok(await f.call('/warehouse-workflow-audit?offset=100'));
 assert.equal(beyond.balances.total,1,'total remains available past last page');assert.deepEqual(beyond.balances.rows,[]);
 assert.equal(await f.balance('other'),99,'audit never silently repairs balances');
});

test('không huỷ phiếu nhập khi OpenClaw đang xử lý hoặc chưa xác định đã tạo trên Sapo; giữ kho chờ đối soát',async()=>{
 const f=await fixture(),c=f.cookies;
 const receipt=ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',lines:[{lineId:'line-a1',goodQty:5}]}),201);
 assert.equal(await f.balance(),5);
 const cancel=()=>f.call('/supplier-receipts/'+receipt.receiptId+'/cancel',c.mgr,'POST',{reason:'Kiểm thử huỷ sau khi đã dừng luồng ngoài'});
 assert.equal((await cancel()).data.code,'RECEIPT_SYNC_IN_PROGRESS');assert.equal(await f.balance(),5);
 const claim=ok(await f.call('/integrations/sapo/goods-receipt-jobs/claim','', 'POST',{crm_receipt_id:receipt.receiptId}));
 assert.equal((await cancel()).data.code,'RECEIPT_SYNC_IN_PROGRESS');
 ok(await f.call('/integrations/sapo/goods-receipt-result','', 'POST',{schema_version:1,action:'goods_receipt_result',idempotency_key:receipt.receiptId,crm_order_id:'a1',crm_receipt_id:receipt.receiptId,lease_token:claim.lease_token,ok:false}));
 assert.equal((await cancel()).data.code,'RECEIPT_SYNC_IN_PROGRESS');assert.equal(await f.balance(),5,'chưa xác định kết quả Sapo không được tự hoàn kho CRM');
});

test('NCC giao thẳng: xác nhận nguồn rồi mới giao; không trừ kho CRM và không giữ hàng ảo tại kho bán',async()=>{
 const f=await fixture(),c=f.cookies;
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:10,kind:'adjust',refType:'adjustment',refId:'fixture-local-stock'}]);
 const held=async()=>ok(await f.call('/stock-holds?warehouseId=vig',c.mgr)).holds.filter((h:any)=>h.orderId===f.order.id).reduce((n:number,h:any)=>n+h.qty,0);
 assert.equal(await held(),5);
 const first=await f.pack(0,'supplier');ok(await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{photos:[photo]}));assert.equal(await f.balance(),10);assert.equal(await held(),3);
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'})).data.code,'STOCK_NOT_PACKED');
 const second=await f.pack(1,'supplier');ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{photos:[photo]}));assert.equal(await held(),0);assert.equal(await f.balance(),10);
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'}));assert.equal(await f.balance(),10);assert.equal(await f.balance('other'),10);
});

// Protect callers beyond the delivery screen (e.g. document amendments/import adapters).
test('hoàn thành tổng phải có xuất đủ; thất bại rollback số đã giao, trạng thái và không tự trừ kho',async()=>{
 const f=await fixture(),before=await f.db.select().from(stockMoves);
 await assert.rejects(f.db.transaction(async tx=>{
  for(const line of f.lines)await tx.update(salesOrderLines).set({deliveredQty:line.qty}).where(eq(salesOrderLines.id,line.id));
  await refreshOrderStatus(tx,f.order.id,'2026-10-25');
 }), (e:any)=>e.code==='STOCK_NOT_PACKED');
 const detail=ok(await f.call('/orders/'+f.order.id,f.cookies.emp));
 assert.equal(detail.order.status,'confirmed');
 assert.ok(detail.lines.every((l:any)=>l.deliveredQty===0));
 assert.deepEqual(await f.db.select().from(stockMoves),before);
 // A stale delivered document must be reported, never converted into fictitious stock proof.
 await f.db.update(salesOrders).set({status:'delivered'}).where(eq(salesOrders.id,f.order.id));
 const stale=ok(await f.call('/orders/'+f.order.id,f.cookies.emp)).progress;
 assert.equal(stale.reconciliationRequired,true);
 assert.equal(stale.stages.find((s:any)=>s.key==='delivered').done,false);
 assert.equal(stale.stages.find((s:any)=>s.key==='export').done,false);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
});
