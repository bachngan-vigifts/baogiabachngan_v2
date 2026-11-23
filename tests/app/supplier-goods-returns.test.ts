import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq,sql} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,supplierReceiptLines,supplierGoodsReturns,supplierRefunds,supplierPayments,supplierOrderSources,suppliers,supplierAccounts,receiptJobs,supplierPaymentSchedules} from '../../src/modules/suppliers/schema.ts';
import {stockMoves,stockBalances} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {stockHolds} from '../../src/modules/sales/schema.ts';
import {vietnamDate} from '../../src/modules/sales/domain/sales.ts';
import {workspaceProductOrders,workspaceList} from '../../src/modules/suppliers/api/workspace-store.ts';
const today=()=>vietnamDate().iso;
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
async function fixture(received=10,paid=false){
 const f=await setup(),stamp=new Date().toISOString(),id=crypto.randomUUID(),line='line-'+id;
 await f.db.insert(suppliers).values({id:'return-ncc',name:'NCC kiểm thử',nameKey:'ncc-kiem-thu',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 await f.db.insert(incomingShipments).values({id,ticketNumber:'DMH-RETURN',source:'supplier-order',supplierId:'return-ncc',supplierName:'NCC kiểm thử',approvalStatus:'approved',supplierStatus:'confirmed',warehouse:'Kho POS',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 await f.db.insert(incomingShipmentLines).values({id:line,shipmentId:id,lineNo:1,sku:'00123',name:'Ly kiểm thử',unit:'cái',quantity:10,price:100,purchaseDiscount:25,taxRate:8,printFee:5});
 await f.db.insert(supplierPaymentSchedules).values({id:'schedule-'+id,shipmentId:id,kind:'balance',amount:864,dueDate:'2099-01-01',createdAt:stamp});
 const get=async()=>{const r=await f.call(`/purchase-orders/${id}`,f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const receive=async(qty:number)=>{const r=await f.call(`/purchase-orders/${id}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho POS',createSapo:false,lines:[{lineId:line,goodQty:qty}]});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.receiptId as string;};
 const receiptId=received?await receive(received):null;
 if(paid){const r=await f.call(`/purchase-orders/${id}/payments`,f.mgr,'POST',{clientKey:crypto.randomUUID(),amount:864,paidDate:today(),method:'transfer',reference:'PAY-TEST'});assert.equal(r.status,201,JSON.stringify(r.data));}
 const request=async(mode='credit',quantity=2,extra:Record<string,unknown>={})=>({clientKey:crypto.randomUUID(),revision:(await get()).revision,mode,receiptId,returnedDate:today(),reason:'Trả hàng theo đối soát kiểm thử',lines:mode==='close'?[]:[{lineId:line,quantity}],...extra});
 const preview=async(body:any)=>f.call(`/purchase-orders/${id}/returns/preview`,f.mgr,'POST',body);
 const submit=async(body:any)=>{const p=await preview(body);assert.equal(p.status,200,JSON.stringify(p.data));return f.call(`/purchase-orders/${id}/returns`,f.mgr,'POST',{...body,previewToken:p.data.previewToken,confirm:true,confirmation:p.data.confirmation});};
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;
 return{...f,id,line,receiptId,get,receive,request,preview,submit,balance};
}
test('Credit return preserves gross receipt/payments; stock and credit post once; actual refund is separate and bounded',async()=>{
 const f=await fixture(10,true),stock=await f.balance(),body=await f.request(),p=await f.preview(body);assert.equal(p.status,200,JSON.stringify(p.data));close(p.data.creditAmount,172.8);assert.equal(p.data.supplierCreditAfter,173);assert.equal(await f.balance(),stock);
 const r=await f.submit(body);assert.equal(r.status,201,JSON.stringify(r.data));close(await f.balance(),stock-2);let v=await f.get();assert.equal(v.receipts[0].lines[0].goodQty,10);assert.equal(v.receipts[0].lines[0].returnedGoodQty,2);assert.equal(v.lines[0].quantity,10);assert.equal(v.lines[0].creditedQty,2);assert.equal(v.progress.good,8);assert.equal(v.progress.missing,0);assert.equal(v.debt.paid,864);assert.equal(v.debt.refunded,0);assert.equal(v.debt.supplierCredit,173);
 const repeat=await f.call(`/purchase-orders/${f.id}/returns`,f.mgr,'POST',{...body,previewToken:p.data.previewToken,confirm:true,confirmation:p.data.confirmation});assert.equal(repeat.status,200,JSON.stringify(repeat.data));assert.equal(repeat.data.duplicate,true);assert.equal(await f.balance(),stock-2);
 assert.equal((await f.preview({...await f.request(),clientKey:body.clientKey,reason:'Nội dung khác hẳn'})).status,409);
 const refund={clientKey:crypto.randomUUID(),amount:173,receivedDate:today(),method:'transfer',reference:'BANK-REFUND-1',note:'Đã đối chiếu sao kê',confirmReceived:true};
 assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...refund,amount:174})).status,409);
 assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',refund)).status,201);assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',refund)).status,200);
 v=await f.get();assert.equal(v.debt.paid,864);assert.equal(v.debt.refunded,173);assert.equal(v.debt.supplierCredit,0);assert.equal(v.debt.balance,0);assert.equal(v.debt.nextDueDate,null);const balanceList=await workspaceList(f.db,'return-ncc','balances',new URLSearchParams(),today());assert.equal(balanceList.items[0]!.dueDate,null);
 const [pay]=await f.db.select().from(supplierPayments);assert.equal(pay!.voidedAt,null);assert.equal((await f.call(`/supplier-payments/${pay!.id}/void`,f.mgr,'POST',{reason:'Không được xoá khoản chi thực'})).status,409);
 assert.equal((await f.db.select().from(supplierGoodsReturns)).length,1);assert.equal((await f.db.select().from(supplierRefunds)).length,1);
 assert.equal((await f.call(`/supplier-receipts/${f.receiptId}/cancel`,f.mgr,'POST',{reason:'Không được trừ lần hai'})).status,409);
});
test('Replacement reopens incoming quantity, never reduces payable, and a later receipt closes the obligation',async()=>{
 const f=await fixture(),stock=await f.balance(),r=await f.submit(await f.request('replacement',3));assert.equal(r.status,201,JSON.stringify(r.data));let v=await f.get();assert.equal(v.debt.total,864);assert.equal(v.lines[0].creditedQty,0);assert.equal(v.progress.good,7);assert.equal(v.progress.missing,3);assert.equal(v.state,'partially_received');assert.equal(await f.balance(),stock-3);
 await f.receive(3);v=await f.get();assert.equal(v.progress.good,10);assert.equal(v.progress.missing,0);assert.equal(v.debt.total,864);assert.equal(await f.balance(),stock);
 const bad=await f.preview(await f.request('replacement',8));assert.equal(bad.status,409,'cannot return more than remains on the original receipt');
});
test('Closing only undelivered remainder changes no stock, keeps payments, and releases source demand deterministically',async()=>{
 const f=await fixture(4,true),stock=await f.balance(),stamp=new Date().toISOString();
 await f.db.insert(quotations).values({id:'source',creatorId:'mgr',quoteNo:'Q-RETURN',quoteType:'B2B',customer:'Khách kiểm thử',data:'{}',quoteDate:today(),createdAt:stamp,updatedAt:stamp});
 await f.db.insert(supplierOrderSources).values({id:'alloc',shipmentId:f.id,lineId:f.line,sourceType:'quote',sourceId:'source',sourceNo:'Q-RETURN',sku:'00123',quantity:10,createdAt:stamp});
 const r=await f.submit(await f.request('close'));assert.equal(r.status,201,JSON.stringify(r.data));const v=await f.get();assert.equal(await f.balance(),stock);assert.equal(v.progress.ordered,4);assert.equal(v.progress.good,4);assert.equal(v.progress.missing,0);assert.equal(v.debt.paid,864);close(v.totals.total,345.6);assert.ok(v.remainderClosedAt);assert.equal((await f.db.select().from(supplierOrderSources))[0]!.cancelledQuantity,6);
 assert.equal((await f.preview(await f.request('close'))).status,409);
 const replacement=await f.submit(await f.request('replacement',2));assert.equal(replacement.status,201,JSON.stringify(replacement.data));assert.equal((await f.get()).progress.missing,2);await f.receive(2);
 const final=await f.submit(await f.request('credit',2));assert.equal(final.status,201,JSON.stringify(final.data));const otherReceipt=(await f.get()).receipts.find((r:any)=>r.id!==f.receiptId).id;assert.equal((await f.submit(await f.request('credit',2,{receiptId:otherReceipt}))).status,201);assert.equal((await f.get()).debt.total,0);assert.equal((await f.get()).debt.supplierCredit,864);
});
test('Unknown Sapo writes block returns; manual verified Sapo reconciliation is explicit and unique',async()=>{
 const f=await fixture(),stamp=new Date().toISOString(),stock=await f.balance();
 await f.db.update(supplierReceipts).set({createSapo:true,sapoStatus:'failed'}).where(eq(supplierReceipts.id,f.receiptId!));
 assert.equal((await f.preview(await f.request())).status,409);assert.equal(await f.balance(),stock);assert.equal((await f.db.select().from(supplierGoodsReturns)).length,0);
 await f.db.update(supplierReceipts).set({sapoStatus:'done',sapoVerifiedAt:stamp,sapoReceiptId:'123',sapoPurchaseOrderId:'456',sapoReceiptCode:'PN-SAPO-1',sapoReceiptUrl:'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/456'}).where(eq(supplierReceipts.id,f.receiptId!));
 assert.equal((await f.preview(await f.request())).status,409);
 const evidence={sapoReturnId:'789',sapoReturnCode:'TRA-789',sapoChecked:true,evidenceNote:'Manager đã đối soát phiếu, kho, số lượng thực trả.'};
 const r=await f.submit(await f.request('credit',2,evidence));assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(await f.balance(),stock-2);
 assert.equal((await f.preview(await f.request('credit',1,evidence))).status,409,'one Sapo return may not be attached twice');
 const [receipt]=await f.db.select().from(supplierReceipts).where(eq(supplierReceipts.id,f.receiptId!));assert.equal(receipt!.sapoReceiptId,'123');assert.equal(receipt!.cancelledAt,null);
});
test('Authorization, malformed/foreign lines, dates, missing prices, zero prices and stale previews fail safely',async()=>{
 const f=await fixture(),body=await f.request(),stock=await f.balance();
 for(const cookie of [f.emp,f.other,f.ncc])assert.equal((await f.call(`/purchase-orders/${f.id}/returns/preview`,cookie,'POST',body)).status,403);
 for(const change of [{lines:[{lineId:'foreign',quantity:1}]},{lines:[{lineId:f.line,quantity:-1}]},{lines:[{lineId:f.line,quantity:1},{lineId:f.line,quantity:1}]},{lines:[{lineId:f.line,quantity:Infinity}]},{returnedDate:'2999-01-01'}])assert.ok((await f.preview({...body,...change})).status>=400);
 const p=await f.preview(body);assert.equal(p.status,200);await f.call(`/purchase-orders/${f.id}/payments`,f.mgr,'POST',{clientKey:crypto.randomUUID(),amount:10,paidDate:today()});
 assert.equal((await f.call(`/purchase-orders/${f.id}/returns`,f.mgr,'POST',{...body,previewToken:p.data.previewToken,confirm:true,confirmation:p.data.confirmation})).status,409);
 await f.db.update(incomingShipmentLines).set({price:null}).where(eq(incomingShipmentLines.id,f.line));assert.equal((await f.preview(await f.request())).status,409);
 await f.db.update(incomingShipmentLines).set({price:0,printFee:0,taxRate:0}).where(eq(incomingShipmentLines.id,f.line));const zero=await f.submit(await f.request());assert.equal(zero.status,201,JSON.stringify(zero.data));assert.equal((await f.get()).totals.total,0);assert.equal(await f.balance(),stock-2);
 assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.emp,'POST',{clientKey:crypto.randomUUID(),amount:1,receivedDate:today(),method:'cash',reference:'test',confirmReceived:true})).status,403);
});
test('Insufficient/held stock and a failure after ledger posting roll back every return effect',async()=>{
 const f=await fixture(),stamp=new Date().toISOString(),stock=await f.balance(),body=await f.request();
 await f.db.insert(quotations).values({id:'held',creatorId:'mgr',quoteNo:'Q-HELD',quoteType:'B2B',customer:'Khách kiểm thử',data:'{}',quoteDate:today(),createdAt:stamp,updatedAt:stamp});
 await f.db.insert(stockHolds).values({id:'hold',quoteId:'held',sku:'00123',qty:stock,expiresAt:'2099-01-01T00:00:00Z',createdBy:'mgr',createdAt:stamp});
 assert.equal((await f.submit(body)).status,409);assert.equal(await f.balance(),stock);
 await f.db.delete(stockHolds).where(eq(stockHolds.id,'hold'));
 await f.db.execute(sql`create function reject_goods_return_test() returns trigger language plpgsql as $$ begin raise exception 'simulated return insert failure'; end $$`);
 await f.db.execute(sql`create trigger reject_goods_return_test before insert on supplier_order_events for each row when (NEW.action='goods_return') execute function reject_goods_return_test()`);
 assert.equal((await f.submit(body)).status,500);assert.equal(await f.balance(),stock);assert.equal((await f.db.select().from(supplierGoodsReturns)).length,0);assert.equal((await f.get()).receipts[0].lines[0].returnedGoodQty,0);assert.equal((await f.get()).lines[0].creditedQty,0);
 await f.db.execute(sql`drop trigger reject_goods_return_test on supplier_order_events`);
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:-(stock-1),kind:'adjust',refType:'adjustment',refId:'consume'}]);
 assert.equal((await f.submit(await f.request())).status,409);assert.equal(await f.balance(),1);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'supplier_return'))).length,0);
});
test('Supplier workspace totals and SKU drill-down use net goods/credit, while sales cannot reopen commercial return snapshots',async()=>{
 const f=await fixture(10,true);assert.equal((await f.submit(await f.request('credit',2))).status,201);
 const products=await workspaceProductOrders(f.db,'return-ncc','00123',new URLSearchParams(),today());assert.equal(products.orderedQuantity,8);assert.equal(products.receivedQuantity,8);assert.equal(products.remainingQuantity,0);
 const list=await workspaceList(f.db,'return-ncc','orders',new URLSearchParams(),today());close(Number(list.items[0]!.total),691.2);
 const staff=await f.call(`/purchase-orders/${f.id}`,f.emp);assert.equal(staff.status,403);assert.equal(staff.data.goodsReturns,undefined);assert.equal(staff.data.refunds,undefined);
});
test('Concurrent duplicate return posts one stock movement; stale competing returns/refunds never over-post',async()=>{
 const f=await fixture(10,true),body=await f.request(),p=await f.preview(body),submitBody={...body,previewToken:p.data.previewToken,confirm:true,confirmation:p.data.confirmation};
 const results=await Promise.all([f.call(`/purchase-orders/${f.id}/returns`,f.mgr,'POST',submitBody),f.call(`/purchase-orders/${f.id}/returns`,f.mgr,'POST',submitBody)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal((await f.db.select().from(supplierGoodsReturns)).length,1);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'supplier_return'))).length,1);
 const refund={amount:173,receivedDate:today(),method:'transfer',reference:'ONE-ACTUAL-REFUND',confirmReceived:true};const refunds=await Promise.all([f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...refund,clientKey:crypto.randomUUID()}),f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...refund,clientKey:crypto.randomUUID()})]);assert.deepEqual(refunds.map(r=>r.status).sort(),[201,409]);assert.equal((await f.get()).debt.refunded,173);
});

test('Competing distinct returns and payment-vs-return serialize on the purchase and reject stale monetary previews',async()=>{
 const f=await fixture(),a=await f.request('credit',7),b=await f.request('credit',7),pa=await f.preview(a),pb=await f.preview(b),stock=await f.balance();
 const send=(body:any,p:any)=>f.call(`/purchase-orders/${f.id}/returns`,f.mgr,'POST',{...body,previewToken:p.previewToken,confirm:true,confirmation:p.confirmation});
 const results=await Promise.all([send(a,pa.data),send(b,pb.data)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(await f.balance(),stock-7);assert.equal((await f.get()).receipts[0].lines[0].returnedGoodQty,7);
 // A late full payment cannot race a credit into an overpayment, and an intervening
 // payment invalidates the exact financial preview rather than silently changing it.
 const c=await f.request('credit',1),pc=await f.preview(c),remaining=(await f.get()).debt.balance;
 const race=await Promise.all([send(c,pc.data),f.call(`/purchase-orders/${f.id}/payments`,f.mgr,'POST',{clientKey:crypto.randomUUID(),amount:remaining,paidDate:today()})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
});
test('A receipt batch from another warehouse cannot be used to return excess stock from the first warehouse',async()=>{
 const f=await fixture(0),stamp=new Date().toISOString();
 const {products,warehouses}=await import('../../src/modules/catalog/schema.ts');
 await f.db.insert(products).values({sku:'SKU-2',name:'Sản phẩm thứ hai',unit:'cái',updatedAt:stamp});
 await f.db.insert(warehouses).values({id:'second-wh',name:'Kho nhận thứ hai',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'OPEN-MARKER',warehouseId:'second-wh',qty:1,kind:'opening',refType:'opening',refId:'second-open'}]);
 const line2='second-line';await f.db.insert(incomingShipmentLines).values({id:line2,shipmentId:f.id,lineNo:2,sku:'SKU-2',name:'Mã 2',quantity:5,price:50,taxRate:0});
 const receive=async(warehouse:string,one:number,two:number)=>{const r=await f.call(`/purchase-orders/${f.id}/receipts`,f.mgr,'POST',{clientKey:crypto.randomUUID(),warehouse,createSapo:false,lines:[{lineId:f.line,goodQty:one},{lineId:line2,goodQty:two}]});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.receiptId;};
 const first=await receive('Kho POS',6,3),second=await receive('Kho nhận thứ hai',4,2),before=await f.balance();
 const bad=await f.preview(await f.request('credit',5,{receiptId:second}));assert.equal(bad.status,409);
 const ok=await f.submit(await f.request('credit',2,{receiptId:second,lines:[{lineId:f.line,quantity:2},{lineId:line2,quantity:1}]}));assert.equal(ok.status,201,JSON.stringify(ok.data));assert.equal(await f.balance(),before);
 const [bal]=await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'second-wh')));assert.equal(bal!.qty,2);
 const v=await f.get();assert.equal(v.receipts.find((r:any)=>r.id===first).lines[0].returnedGoodQty,0);assert.equal(v.goodsReturns[0].items.length,2);
});

test('Partial refunds require distinct evidence; kill switch stops writes without hiding posted accounting state',async()=>{
 const f=await fixture(10,true);assert.equal((await f.submit(await f.request('credit',2))).status,201);
 const body={amount:50,receivedDate:today(),method:'transfer',reference:'BANK-ONE',confirmReceived:true};
 assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...body,clientKey:crypto.randomUUID()})).status,201);
 assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...body,reference:' bank-one ',clientKey:crypto.randomUUID()})).status,409);
 assert.equal((await f.get()).debt.refunded,50);assert.equal((await f.get()).debt.supplierCredit,123);
 const balances=await workspaceList(f.db,'return-ncc','balances',new URLSearchParams(),today());assert.equal(balances.items[0]!.paid,864);assert.equal(balances.items[0]!.netPaid,814);assert.equal(balances.items[0]!.supplierCredit,123);assert.equal(balances.items[0]!.status,'refund_due');
 f.env.supplierReturnsDisabled=true;assert.equal((await f.get()).canReturn,false);
 assert.equal((await f.preview(await f.request('replacement',1))).status,503);assert.equal((await f.call(`/purchase-orders/${f.id}/refunds`,f.mgr,'POST',{...body,reference:'BANK-TWO',clientKey:crypto.randomUUID()})).status,503);
 const v=await f.get();assert.equal(v.goodsReturns.length,1);assert.equal(v.refunds.length,1);assert.equal(v.debt.refunded,50);
});

test('Fractional returns allocate credit proportionally and repeated decimal quantities cannot overrun receipt counters',async()=>{
 const f=await fixture(),stock=await f.balance();
 assert.equal((await f.submit(await f.request('credit',0.1))).status,201);assert.equal((await f.submit(await f.request('credit',0.2))).status,201);
 let v=await f.get();assert.equal(v.receipts[0].lines[0].returnedGoodQty,0.3);assert.equal(v.lines[0].creditedQty,0.3);close(v.totals.total,838.08);assert.equal(v.progress.missing,0);const portal=await workspaceProductOrders(f.db,'return-ncc','00123',new URLSearchParams(),today());close(portal.orderedQuantity,9.7);close(portal.receivedQuantity,9.7);
 assert.equal((await f.submit(await f.request('credit',9.7))).status,201);v=await f.get();assert.equal(v.receipts[0].lines[0].returnedGoodQty,10);assert.equal(v.totals.total,0);assert.equal(v.progress.good,0);assert.equal(v.canReturn,false);assert.match(v.stateLabel,/Đã trả/);close(await f.balance(),stock-10);const listed=await workspaceList(f.db,'return-ncc','orders',new URLSearchParams(),today());assert.equal(listed.items[0]!.status,'closed');
});

test('Supplier portal exposes only its own return/refund summary and omits internal allocation/evidence details',async()=>{
 const f=await fixture(10,true),stamp=new Date().toISOString();await f.db.insert(supplierAccounts).values({memberId:'ncc',supplierId:'return-ncc',createdBy:'mgr',createdAt:stamp}).onConflictDoUpdate({target:supplierAccounts.memberId,set:{supplierId:'return-ncc'}});
 assert.equal((await f.submit(await f.request('credit',2))).status,201);
 const own=await f.call(`/supplier-portal/workspace/orders/${f.id}`,f.ncc);assert.equal(own.status,200,JSON.stringify(own.data));close(own.data.totals.total,691.2);assert.equal(own.data.progress.good,8);assert.equal(own.data.returns.length,1);assert.deepEqual(Object.keys(own.data.returns[0].items[0]).sort(),['quantity','sku']);assert.equal('reason' in own.data.returns[0],false);assert.equal('evidenceNote' in own.data.returns[0],false);
 await f.db.insert(suppliers).values({id:'other-ncc',name:'NCC khác',nameKey:'ncc-khac',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});await f.db.insert(incomingShipments).values({id:'foreign-order',ticketNumber:'OTHER-PRIVATE',source:'supplier-order',supplierId:'other-ncc',supplierName:'NCC khác',approvalStatus:'approved',warehouse:'Kho POS',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 assert.equal((await f.call('/supplier-portal/workspace/orders/foreign-order',f.ncc)).status,404);
});

test('Warehouse rename/name reuse cannot redirect the return away from the original receipt ledger warehouse',async()=>{
 const f=await fixture(),{warehouses}=await import('../../src/modules/catalog/schema.ts');
 await f.db.update(warehouses).set({name:'Kho gốc đã đổi tên'}).where(eq(warehouses.id,'pos-wh'));
 await f.db.insert(warehouses).values({id:'reused-name',name:'Kho POS',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'reused-name',qty:100,kind:'opening',refType:'opening',refId:'reused-open'}]);
 const stock=await f.balance(),body=await f.request(),p=await f.preview(body);assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.warehouseId,'pos-wh');assert.equal(p.data.warehouse,'Kho gốc đã đổi tên');
 assert.equal((await f.submit(body)).status,201);assert.equal(await f.balance(),stock-2);const [other]=await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'reused-name')));assert.equal(other!.qty,100);const history=await f.call('/products/00123/history',f.mgr);const returned=history.data.history.find((r:any)=>r.kind==='supplier_return');assert.equal(returned.location,'Kho gốc đã đổi tên');assert.equal(returned.link,'#/purchases/'+f.id);
});
