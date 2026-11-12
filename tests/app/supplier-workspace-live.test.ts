import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments,incomingShipmentLines,supplierPayments,supplierPaymentSchedules,supplierReceipts,supplierReceiptLines} from '../../src/modules/suppliers/schema.ts';
import {computeOrderTotals} from '../../src/modules/suppliers/domain/order-totals.ts';
import {supplierDebt} from '../../src/modules/suppliers/domain/purchasing.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {stockTransfers,stockTransferLines} from '../../src/modules/inventory/schema.ts';

test('live workspace reads all pages with supplier SQL scope, canonical money and no internal notes',async()=>{
 const {db,call,cookies:c}=await setupEarly();
 await db.update(incomingShipmentLines).set({price:12345,printFee:123,taxRate:8,purchaseDiscount:12.5}).where(eq(incomingShipmentLines.shipmentId,'a1'));
 await db.update(incomingShipmentLines).set({price:23456,taxRate:10}).where(eq(incomingShipmentLines.shipmentId,'a2'));
 await db.update(incomingShipments).set({note:'PRIVATE-CUSTOMER-SOURCE',extra:'{"private":"HIDDEN"}'}).where(eq(incomingShipments.id,'a1'));
 await db.insert(supplierPayments).values({id:'payment-test',shipmentId:'a1',amount:1000,paidDate:'2026-11-01',method:'transfer',clientKey:'payment-fixture-01',reference:'PAY-REAL',createdAt:'2026-11-01T00:00:00Z',createdBy:'mgr'});
 await db.insert(supplierPaymentSchedules).values({id:'schedule-test',shipmentId:'a1',kind:'deposit',amount:10000,dueDate:'2026-11-01',createdAt:'2026-11-01T00:00:00Z'});
 const profile=await call('/supplier-portal/workspace',c.ncc);assert.equal(profile.status,200);assert.equal(profile.data.supplier.id,'a');assert.equal(profile.data.manager,false);
 for(const page of ['overview','products','stock','orders','requests','transfers','advances','balances','invoices','deliveries']){
  const result=await call('/supplier-portal/workspace/'+page,c.ncc);assert.equal(result.status,200,page+': '+JSON.stringify(result.data));assert.ok(Array.isArray(result.data.items));assert.doesNotMatch(JSON.stringify(result.data),/PO-b1|"NCC b"|PRIVATE-CUSTOMER-SOURCE|HIDDEN|customerName|attachmentKey/);assert.ok(result.data.metrics.every((m:any)=>m.value===null||typeof m.value==='number'),'metric DTO values are numbers, not PostgreSQL numeric strings');
  assert.equal((await call('/supplier-portal/workspace/'+page+'?supplierId=b',c.ncc)).status,404);
 }
 const lines=await db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,'a1'));
 const expected=computeOrderTotals({rows:lines,depositRate:null,paidAmount:0}),debt=supplierDebt(expected.total,[{kind:'deposit',amount:10000,dueDate:'2026-11-01'}],[{amount:1000,paidDate:'2026-11-01',voidedAt:null}],'2026-11-12');
 const detail=await call('/supplier-portal/workspace/orders/a1',c.ncc);assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.totals.total,expected.total);assert.equal(detail.data.debt.balance,debt.balance);
 const list=await call('/supplier-portal/workspace/orders',c.ncc);const a1=list.data.items.find((r:any)=>r.id==='a1');assert.equal(a1.total,expected.total);assert.equal(a1.remaining,debt.balance);assert.equal(a1.overdue,debt.overdue);
 assert.ok(list.data.metrics.some((m:any)=>m.money&&m.value>0));
 assert.equal((await call('/supplier-portal/workspace/orders/b1',c.ncc)).status,404);
 assert.equal((await call('/supplier-portal/workspace/orders',c.emp)).status,403);
 assert.equal((await call('/supplier-portal/workspace/orders?limit=101',c.ncc)).status,400);
 assert.equal((await call('/supplier-portal/workspace/orders?from=2026-02-31',c.ncc)).status,400);
 const malicious=await call('/supplier-portal/workspace/orders?q='+encodeURIComponent("' OR 1=1 --"),c.ncc);assert.equal(malicious.status,200);assert.equal(malicious.data.total,0);
 assert.equal((await call('/supplier-portal/workspace/orders?asOf=2020-01-01',c.ncc)).status,400,'no fabricated historical balance');
 const managers=await call('/supplier-portal/workspace-suppliers',c.mgr);assert.equal(managers.status,200);assert.equal(managers.data.suppliers.length,2);
 assert.equal((await call('/supplier-portal/workspace-suppliers',c.ncc)).status,403);
 const exportData=await call('/supplier-portal/workspace/orders/export?q=PO-a1',c.ncc);assert.equal(exportData.status,200);assert.equal(exportData.data.total,1);
});

test('live balances match canonical rounding, voided payments and partial receipt history',async()=>{
 const{db,call,cookies:c}=await setupEarly();
 await db.update(incomingShipmentLines).set({quantity:2.5,price:101.25,printFee:2.35,taxRate:8,purchaseDiscount:.5}).where(eq(incomingShipmentLines.id,'line-a1'));
 const schedules=[{id:'one',shipmentId:'a1',kind:'installment' as const,amount:100.5,dueDate:'2026-11-01',createdAt:'2026-11-01T00:00:00Z'},{id:'two',shipmentId:'a1',kind:'balance' as const,amount:200.5,dueDate:'2026-11-02',createdAt:'2026-11-01T00:00:00Z'}];await db.insert(supplierPaymentSchedules).values(schedules);
 const payments=[{id:'live-pay',shipmentId:'a1',amount:50.4,paidDate:'2026-11-01',method:'transfer' as const,clientKey:'live-payment-1',createdAt:'2026-11-01T00:00:00Z',createdBy:'mgr',voidedAt:null},{id:'void-pay',shipmentId:'a1',amount:200,paidDate:'2026-11-01',method:'transfer' as const,clientKey:'live-payment-2',createdAt:'2026-11-01T00:00:00Z',createdBy:'mgr',voidedAt:'2026-11-02T00:00:00Z'}];await db.insert(supplierPayments).values(payments);
 await db.insert(supplierReceipts).values([{id:'got-valid',receiptNo:'PN-VALID',shipmentId:'a1',receivedDate:'2026-11-01',receivedBy:'mgr',clientKey:'valid-receipt',createdAt:'2026-11-01T00:00:00Z'},{id:'got-void',receiptNo:'PN-VOID',shipmentId:'a1',receivedDate:'2026-11-01',receivedBy:'mgr',clientKey:'void-receipt',createdAt:'2026-11-01T00:00:00Z',cancelledAt:'2026-11-02T00:00:00Z'}]);
 await db.insert(supplierReceiptLines).values([{receiptId:'got-valid',lineId:'line-a1',sku:'031106000',goodQty:1,damagedQty:1},{receiptId:'got-void',lineId:'line-a1',sku:'031106000',goodQty:1,damagedQty:0}]);
 const lines=await db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,'a1')),total=computeOrderTotals({rows:lines,depositRate:null,paidAmount:0}).total,expected=supplierDebt(total,schedules,payments,'2026-11-12');
 const result=await call('/supplier-portal/workspace/balances?id=a1',c.ncc);assert.equal(result.status,200,JSON.stringify(result.data));const row=result.data.items[0];assert.ok(Math.abs(row.total-total)<1e-6);assert.equal(row.paid,expected.paid);assert.equal(row.remaining,expected.balance);assert.equal(row.overdue,expected.overdue);
 const orders=await call('/supplier-portal/workspace/orders?id=a1',c.ncc);assert.equal(orders.data.items[0].status,'partially_received');assert.equal(orders.data.items[0].received,1);
 const deliveries=await call('/supplier-portal/workspace/deliveries',c.ncc);assert.equal(deliveries.data.metrics.find((m:any)=>m.label==='SL công ty đã nhận đạt').value,1,'void receipt never counts as received; damaged quantity is separate');
});

test('live missing prices are unknown, and price filters use agreed unit price after discount and print fee',async()=>{
 const{db,call,cookies:c}=await setupEarly();
 await db.update(incomingShipments).set({cancelledAt:'2026-11-01T00:00:00Z'}).where(eq(incomingShipments.id,'a2'));
 const balances=await call('/supplier-portal/workspace/balances',c.ncc);assert.equal(balances.status,200);assert.equal(balances.data.items[0].total,null);assert.equal(balances.data.items[0].remaining,null);assert.equal(balances.data.items[0].status,'unknown');assert.ok(balances.data.warnings.length);
 await db.update(incomingShipmentLines).set({price:100,purchaseDiscount:50,printFee:5}).where(eq(incomingShipmentLines.id,'line-a1'));
 const products=await call('/supplier-portal/workspace/products?min=55&max=55&warehouse=Kho',c.ncc);assert.equal(products.status,200);assert.equal(products.data.total,1);assert.equal(products.data.items[0].price,55);
});

test('live export stays paginated in UI with a thousand real database orders',async()=>{
 const{db,call,cookies:c}=await setupEarly();const at='2024-11-01T00:00:00Z';
 for(let start=0;start<1000;start+=200){const rows=Array.from({length:200},(_,j)=>({id:'perf-'+(start+j),ticketNumber:'PERF-'+(start+j),source:'supplier-order' as const,supplierId:'a',warehouse:'Kho',approvalStatus:'approved' as const,createdBy:'mgr',createdAt:at,updatedAt:at}));await db.insert(incomingShipments).values(rows);await db.insert(incomingShipmentLines).values(rows.map(o=>({id:'line-'+o.id,shipmentId:o.id,lineNo:1,sku:'PERF-SKU',name:'Hàng kiểm thử tải',unit:'Cái',quantity:10,price:100,taxRate:8})));}
 const started=performance.now(),response=await call('/supplier-portal/workspace/orders?limit=16',c.ncc),elapsed=performance.now()-started;
 assert.equal(response.status,200);assert.equal(response.data.total,1002);assert.equal(response.data.items.length,16);assert.ok(JSON.stringify(response.data).length<50000);assert.equal(response.data.metrics.find((m:any)=>m.money).value,1080000);
 console.log('Live API/PGlite 1000 orders, page 16: '+elapsed.toFixed(1)+' ms; not a production benchmark');
});

test('transfer sharing is explicit, revocable and never lets supplier receive stock internally',async()=>{
 const{db,call,cookies:c}=await setupEarly();await db.insert(warehouses).values([{id:'t-from',name:'Kho đi',kind:'stock'},{id:'t-to',name:'Kho đến',kind:'stock'}]);
 await db.insert(stockTransfers).values({id:'t-one',transferNo:'DC-SHARE',fromWarehouseId:'t-from',toWarehouseId:'t-to',status:'approved',requestedBy:'mgr',createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z'});
 await db.insert(stockTransferLines).values({id:'tl-one',transferId:'t-one',sku:'031106000',qty:5});
 assert.equal((await call('/supplier-portal/workspace/transfers',c.ncc)).data.total,0);
 assert.equal((await call('/supplier-workspace-admin/transfer-shares?supplierId=a',c.ncc,'POST',{orderId:'a1',transferId:'t-one'})).status,403);
 assert.equal((await call('/supplier-workspace-admin/transfer-shares?supplierId=a',c.mgr,'POST',{orderId:'a1',transferId:'t-one'})).status,200);
 const own=await call('/supplier-portal/workspace/transfers',c.ncc);assert.equal(own.data.total,1);const id=own.data.items[0].id;
 assert.equal((await call('/supplier-portal/workspace/transfers',c.ncc2)).data.total,0);assert.equal((await call('/supplier-portal/workspace/transfers/'+id,c.ncc2)).status,404);
 assert.equal((await call('/supplier-portal/workspace/transfers/'+id+'/acknowledge',c.ncc,'POST',{})).status,200);assert.equal((await call('/supplier-portal/workspace/transfers/'+id+'/acknowledge',c.ncc,'POST',{})).data.replayed,true);
 assert.equal((await db.select().from(stockTransfers).where(eq(stockTransfers.id,'t-one')))[0]!.status,'approved');
 await db.insert(stockTransferLines).values({id:'tl-foreign',transferId:'t-one',sku:'FOREIGN',qty:999});
 assert.equal((await call('/supplier-portal/workspace/transfers',c.ncc)).data.total,0,'changed document with foreign SKU is hidden');
 assert.equal((await call('/supplier-portal/workspace/transfers/'+id+'/acknowledge',c.ncc,'POST',{})).status,404);
 assert.equal((await call('/supplier-workspace-admin/transfer-shares/'+id,c.mgr,'DELETE')).status,200);
 assert.equal((await call('/supplier-portal/workspace/transfers/'+id,c.ncc)).status,404);
});

test('supplier documents and published stock persist without changing receipts, payments or company stock',async()=>{
 const {db,call,cookies:c,client}=await setupEarly();
 await db.update(incomingShipmentLines).set({price:100,taxRate:8}).where(eq(incomingShipmentLines.shipmentId,'a1'));
 await db.update(incomingShipments).set({supplierStatus:'confirmed',depositRate:30}).where(eq(incomingShipments.id,'a1'));
 const counts=async()=>(await client.query('select (select count(*)::int from supplier_payments) payments,(select count(*)::int from supplier_receipts) receipts,(select count(*)::int from stock_moves) moves')).rows[0];const before=await counts();
 const stock={sku:'031106000',warehouse:'Kho NCC thực',onHand:100,reserved:20,incoming:50,revision:0};
 assert.equal((await call('/supplier-portal/workspace/stock',c.ncc,'PUT',stock)).status,200);
 assert.equal((await call('/supplier-portal/workspace/stock',c.ncc,'PUT',stock)).status,409);
 const stocks=await call('/supplier-portal/workspace/stock',c.ncc);assert.equal(stocks.data.items[0].available,80);
 const other=await call('/supplier-portal/workspace/stock',c.ncc2);assert.ok(other.data.items.every((r:any)=>r.onHand===null));
 const invoice={clientKey:'invoice-test-0001',orderId:'a1',invoiceNo:'0000123',series:'AA26',date:'2026-11-12',subtotal:1000,tax:80,total:1080};
 const inv=await call('/supplier-portal/workspace/invoices',c.ncc,'POST',invoice);assert.equal(inv.status,201,JSON.stringify(inv.data));assert.equal((await call('/supplier-portal/workspace/invoices',c.ncc,'POST',invoice)).data.replayed,true);
 assert.equal((await call('/supplier-portal/workspace/invoices',c.ncc,'POST',{...invoice,total:1081})).status,400);
 assert.equal((await call('/supplier-portal/workspace/invoices',c.ncc2,'POST',{...invoice,clientKey:'invoice-other001'})).status,404);
 assert.equal((await call('/supplier-workspace-admin/invoices/'+inv.data.id+'/verify',c.ncc,'POST',{status:'verified'})).status,403);
 assert.equal((await call('/supplier-workspace-admin/invoices/'+inv.data.id+'/verify',c.mgr,'POST',{status:'verified'})).status,200);
 const delivery={clientKey:'delivery-test-001',orderId:'a1',deliveryNo:'PGH-TEST-001',date:'2026-11-12',lines:[{lineId:'line-a1',quantity:100}]};
 const del=await call('/supplier-portal/workspace/deliveries',c.ncc,'POST',delivery);assert.equal(del.status,201,JSON.stringify(del.data));assert.equal((await call('/supplier-portal/workspace/deliveries',c.ncc,'POST',delivery)).data.replayed,true);
 assert.equal((await call('/supplier-portal/workspace/deliveries',c.ncc,'POST',{...delivery,clientKey:'delivery-test-002',deliveryNo:'PGH-TEST-002',lines:[{lineId:'line-a1',quantity:8000}]})).status,409);
 assert.equal((await call('/supplier-portal/workspace/orders/a1/deposit',c.ncc,'POST',{revision:1})).status,200);
 assert.equal((await call('/supplier-portal/workspace/orders/a1/deposit',c.ncc,'POST',{revision:1})).status,200);
 assert.equal((await call('/supplier-portal/workspace/orders/a1/deposit?supplierId=a',c.mgr,'POST',{revision:2})).status,403);
 assert.deepEqual(await counts(),before);
});
