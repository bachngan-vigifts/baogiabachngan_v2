import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {salesOrderLines,salesOrders,salesContracts,orderProgressMarks,deliveries,deliveryLines,packingSlips} from '../../src/modules/sales/schema.ts';
import {crmStockFulfilment} from '../../src/modules/sales/api/crm-stock-lifecycle.ts';
import {refreshOrderStatus} from '../../src/modules/sales/api/routes.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {fixture,ok,photo,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
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
 assert.equal(storeResult.status,400);assert.equal(await f.balance('other'),10);
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

for(const source of ['supplier','agent','store','other'])test(`${source}: bắt buộc nhập kho rồi xuất, không nguồn nào bỏ qua ledger`,async()=>{
 const f=await fixture(),c=f.cookies;
 const first=await f.pack(0,source);
 assert.equal((await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{photos:[photo]})).status,400);
 assert.equal((await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'other',photos:[photo]})).status,400,'không lấy kho khác thay kho bán');
 assert.equal((await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]})).data.code,'STOCK_SHORT','kho nguồn có tồn không thay được nhập/điều chuyển vào kho xuất');
 assert.equal(ok(await f.call('/packing/'+first.id,c.kho)).slip.status,'sent');
 assert.equal((await f.db.select().from(stockMoves)).some(m=>m.refId===first.id),false);
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',lines:[{lineId:'line-a1',goodQty:5}]}),201);
 assert.equal(await f.balance(),5);
 const held=async()=>ok(await f.call('/stock-holds?warehouseId=vig',c.mgr)).holds.filter((h:any)=>h.orderId===f.order.id).reduce((n:number,h:any)=>n+h.qty,0);
 assert.equal(await held(),5);
 ok(await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),3);assert.equal(await held(),3);
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'})).data.code,'STOCK_NOT_PACKED');
 const second=await f.pack(1,source);ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));
 assert.equal(await f.balance(),0);assert.equal(await held(),0);
 ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}),409);assert.equal(await f.balance(),0);
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'}));assert.equal(await f.balance(),0);assert.equal(await f.balance('other'),10);
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

test('221 kho + 29 NCC nhập kho: 229 - 221 + 29 - 29 = 8, xác nhận lại không trừ hai lần',async()=>{
 const f=await fixture(),c=f.cookies;
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:229,kind:'opening',refType:'opening',refId:'initial-229'}]);
 for(const [i,qty] of [[0,221],[1,29]] as const){
  f.lines[i]!.qty=qty;
  await f.db.update(salesOrderLines).set({qty}).where(eq(salesOrderLines.id,f.lines[i]!.id));
  await f.db.update(deliveryLines).set({qty}).where(eq(deliveryLines.orderLineId,f.lines[i]!.id));
 }
 await f.db.update(incomingShipmentLines).set({quantity:29}).where(eq(incomingShipmentLines.id,'line-a1'));
 await f.db.update(salesOrders).set({warehouseId:null}).where(eq(salesOrders.id,f.order.id));
 const first=await f.pack(0),second=await f.pack(1,'supplier');
 ok(await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),8);
 assert.equal((await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]})).data.code,'STOCK_SHORT');
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',lines:[{lineId:'line-a1',goodQty:29}]}),201);assert.equal(await f.balance(),37);
 ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),8);
 ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}),409);assert.equal(await f.balance(),8);
 assert.equal((await crmStockFulfilment(f.db,[f.order.id])).get(f.order.id)?.complete,true);
});

test('phiếu NCC/đại lý cũ đã packed nhưng chưa có bút toán không được tính xuất hoặc bỏ giữ hàng',async()=>{
 const f=await fixture(),c=f.cookies,p=await f.pack(0,'supplier');
 await f.db.update(packingSlips).set({status:'packed',packedBy:'mgr',packedAt:new Date().toISOString(),stockWarehouseId:'vig'}).where(eq(packingSlips.id,p.id));
 const state=(await crmStockFulfilment(f.db,[f.order.id])).get(f.order.id)!;assert.equal(state.lines[0]!.issued,0);assert.equal(state.complete,false);
 const holds=ok(await f.call('/stock-holds?warehouseId=vig',c.mgr)).holds.filter((h:any)=>h.orderId===f.order.id);
 assert.equal(holds.reduce((n:number,h:any)=>n+h.qty,0),5);
 assert.equal((await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'})).data.code,'STOCK_NOT_PACKED');
});

test('legacy chỉ trừ trước 2/5: không miễn trừ cả phiếu 3 còn lại vì có bất kỳ sales_order move',async()=>{
 const f=await fixture(),c=f.cookies;
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:5,kind:'opening',refType:'opening',refId:'legacy-opening'}]);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:-2,kind:'sale',refType:'sales_order',refId:f.order.id}]);
 const first=await f.pack(0,'supplier');ok(await f.call('/packing/'+first.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),3);
 const second=await f.pack(1,'agent');ok(await f.call('/packing/'+second.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));assert.equal(await f.balance(),0);
 assert.equal((await f.db.select().from(stockMoves)).filter(m=>m.refId===second.id).reduce((n,m)=>n+m.qty,0),-3);
 assert.equal((await crmStockFulfilment(f.db,[f.order.id])).get(f.order.id)?.complete,true);
});

test('legacy đã xuất trực tiếp đầy đủ, chưa dùng packing: công nhận ledger thật, không ép xuất lần hai',async()=>{
 const f=await fixture();
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:5,kind:'opening',refType:'opening',refId:'legacy-complete-opening'}]);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:-5,kind:'sale',refType:'sales_order',refId:f.order.id}]);
 assert.equal((await crmStockFulfilment(f.db,[f.order.id])).get(f.order.id)?.complete,true);
 assert.equal(await f.balance(),0);
});

test('HĐKT cũng không được hoàn tất khi chưa đủ xuất, không đổi revision/tài chính khi bị chặn',async()=>{
 const f=await fixture(),at=new Date().toISOString();
 await f.db.insert(salesContracts).values({id:'contract-stock',contractNo:'HĐKT-STOCK',orderId:f.order.id,legalEntity:'BN',status:'signed',createdBy:'mgr',createdAt:at,updatedAt:at});
 const denied=await f.call('/contracts/contract-stock',f.cookies.mgr,'PUT',{status:'completed',revision:1,paymentDays:10});
 assert.equal(denied.data.code,'STOCK_NOT_PACKED');const [unchanged]=await f.db.select().from(salesContracts);assert.equal(unchanged!.status,'signed');assert.equal(unchanged!.revision,1);assert.equal(unchanged!.paymentDays,0);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:5,kind:'opening',refType:'opening',refId:'contract-stock-opening'}]);
 for(const i of [0,1]){const p=await f.pack(i,'supplier');ok(await f.call('/packing/'+p.id+'/confirm',f.cookies.kho,'POST',{warehouseId:'vig',photos:[photo]}));}
 ok(await f.call('/contracts/contract-stock',f.cookies.mgr,'PUT',{status:'completed',revision:1}));
});
