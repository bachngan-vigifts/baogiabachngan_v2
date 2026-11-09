import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {beforeEach,afterEach,mock} from 'node:test';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {products,warehouses,productStock,productMovements,pricePolicies,productPrices} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {orderStockHolds} from '../../src/modules/sales/schema.ts';
import {incomingShipments,incomingShipmentLines,suppliers,supplierReceipts,supplierReceiptLines} from '../../src/modules/suppliers/schema.ts';
import {homeStockValue} from '../../src/app/home-stock-value.ts';
import {homeStockFilters,UNASSIGNED} from '../../src/app/home-stock-sources.ts';
const now='2026-11-09T02:00:00.000Z',past='2026-11-08T02:00:00.000Z';
beforeEach(()=>mock.timers.enable({apis:['Date'],now:Date.parse(now)}));afterEach(()=>mock.timers.reset());
async function fixture(){const f=await homeFixture();await f.db.update(warehouses).set({active:false});await f.db.insert(warehouses).values([{id:'hv-sapo',name:'Kho Sapo',kind:'stock'},{id:'hv-ledger',name:'Kho CRM',kind:'stock'},{id:'hv-private',name:'Kho riêng',kind:'stock',stockPrivate:true},{id:'hv-empty',name:'Kho chưa có số liệu',kind:'stock'},{id:'hv-supplier',name:'Tồn NCC',kind:'supplier'},{id:'hv-incoming',name:'Hàng đang về',kind:'incoming'},{id:'hv-inactive',name:'Kho ngừng',kind:'stock',active:false}]);return f;}
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('Home stock value uses ledger after opening, values physical positive stock at matched latest cost, preserves held/archived/zero-cost stock and reports missing/negative data',async()=>{
 const f=await fixture();await f.db.insert(products).values(['A','MISSING','FREE','ARCHIVED','NEGATIVE','MISMATCH'].map(sku=>({sku,name:sku,unit:'Cái',active:sku!=='ARCHIVED',updatedAt:past})));
 await f.db.insert(productStock).values([{sku:'A',warehouseId:'hv-sapo',quantity:10,updatedAt:past},{sku:'A',warehouseId:'hv-ledger',quantity:99,updatedAt:past},{sku:'A',warehouseId:'hv-private',quantity:1,updatedAt:past},{sku:'A',warehouseId:'hv-supplier',quantity:1000,updatedAt:past},{sku:'A',warehouseId:'hv-incoming',quantity:1000,updatedAt:past},{sku:'A',warehouseId:'hv-inactive',quantity:1000,updatedAt:past},{sku:'MISSING',warehouseId:'hv-sapo',quantity:2,updatedAt:past},{sku:'FREE',warehouseId:'hv-sapo',quantity:3,updatedAt:past},{sku:'ARCHIVED',warehouseId:'hv-sapo',quantity:2,updatedAt:past},{sku:'MISMATCH',warehouseId:'hv-sapo',quantity:1,updatedAt:past}]);
 await f.db.insert(stockMoves).values({id:'hv-opening',sku:'A',warehouseId:'hv-ledger',qty:2,kind:'opening',refType:'opening',refId:'hv-opening',createdBy:'mgr',createdAt:past});await f.db.insert(stockBalances).values([{sku:'A',warehouseId:'hv-ledger',qty:2,updatedAt:now},{sku:'NEGATIVE',warehouseId:'hv-ledger',qty:-1,updatedAt:now}]);
 await f.db.insert(productMovements).values([{id:'hv-old',refKey:'hv-old',sku:'A',kind:'purchase',qty:1,unit:'Cái',unitPrice:100,occurredAt:'2026-11-01T02:00:00Z',recordedAt:past},{id:'hv-current',refKey:'hv-current',sku:'A',kind:'purchase',qty:1,unit:'Cái',unitPrice:200,occurredAt:past,recordedAt:past},{id:'hv-future',refKey:'hv-future',sku:'A',kind:'purchase',qty:1,unit:'Cái',unitPrice:9999,occurredAt:'2026-11-10T02:00:00Z',recordedAt:past},{id:'hv-cancelled',refKey:'hv-cancelled',sku:'A',kind:'purchase',qty:1,unit:'Cái',unitPrice:8888,status:'cancelled',occurredAt:'2026-11-09T01:00:00Z',recordedAt:past},{id:'hv-box',refKey:'hv-box',sku:'A',kind:'purchase',qty:1,unit:'Thùng',unitPrice:7777,occurredAt:'2026-11-09T01:00:00Z',recordedAt:past},...['FREE','ARCHIVED','MISMATCH'].map(sku=>({id:'hv-'+sku,refKey:'hv-'+sku,sku,kind:'purchase' as const,qty:1,unit:sku==='MISMATCH'?'Thùng':'Cái',unitPrice:sku==='FREE'?0:50,occurredAt:past,recordedAt:past}))]);
 await f.db.insert(orderStockHolds).values({id:'hv-held',orderId:'liq-order',orderLineId:'liq-service',sku:'A',warehouseId:'hv-sapo',qty:8,source:'manual',expiresAt:'2026-11-30T00:00:00Z',createdBy:'mgr',createdAt:past});
 const before=await f.client.query('select count(*)::int as n from stock_moves');const d=ok(await f.call('/admin/home-stock-value?priceBasis=purchase',f.cookies.mgr));
 assert.equal(d.totalValue,2700);assert.equal(d.missingSkus,2);assert.equal(d.negativeRows,1);assert.equal(d.inventory.length,4);
 const sapo=d.inventory.find((w:any)=>w.id==='hv-sapo'),ledger=d.inventory.find((w:any)=>w.id==='hv-ledger');assert.equal(sapo.value,2100);assert.equal(sapo.pricedSkus,3);assert.equal(sapo.source,'sapo');assert.equal(ledger.value,400);assert.equal(ledger.source,'ledger');assert.equal(ledger.updatedAt,now);assert.equal(d.inventory.find((w:any)=>w.id==='hv-empty').hasStockData,false);assert.equal(d.inventory.find((w:any)=>w.id==='hv-private').value,200);
 assert.deepEqual((await f.client.query('select count(*)::int as n from stock_moves')).rows,before.rows);
 for(const cookie of [f.cookies.wh,f.cookies.emp,f.cookies.acct,f.cookies.admin,f.cookies.ncc])ok(await f.call('/admin/home-stock-value',cookie),403);ok(await f.call('/admin/home-stock-value'),401);
});
test('Home valuation marks approved NCC and catalog formula as reference, excludes future/cancelled/unapproved costs and keeps unknown costs unvalued',async()=>{
 const f=await fixture();await f.db.insert(products).values([{sku:'ORDER',name:'Theo đơn mua',unit:'Cái',updatedAt:past},{sku:'RULE',name:'Hàng Lock',brand:'Lock',unit:'Cái',taxable:true,taxOut:8,taxBasis:'Giá đã bao gồm thuế',updatedAt:past},{sku:'NO-COST',name:'Chưa có giá',unit:'Cái',updatedAt:past}]);
 await f.db.insert(productStock).values(['ORDER','RULE','NO-COST'].map(sku=>({sku,warehouseId:'hv-sapo',quantity:2,updatedAt:past})));
 await f.db.insert(pricePolicies).values({id:'hv-retail',name:'Giá bán lẻ + VAT',sortOrder:999});await f.db.insert(productPrices).values({sku:'RULE',policyId:'hv-retail',price:1080});
 await f.db.insert(suppliers).values({id:'hv-ncc',name:'NCC kiểm thử',nameKey:'ncc kiem thu',createdBy:'mgr',createdAt:past,updatedAt:past});
 for(const [id,status,at,cancelled]of [['valid','approved',past,null],['pending','pending',now,null],['future','approved','2026-11-10T00:00:00Z',null],['cancelled','approved',now,now]] as const){
  await f.db.insert(incomingShipments).values({id:'hv-'+id,ticketNumber:'HV-'+id,source:'supplier-order',approvalStatus:status,supplierId:'hv-ncc',warehouse:'Kho Sapo',approvedAt:at,cancelledAt:cancelled,createdBy:'mgr',createdAt:past,updatedAt:past});
  await f.db.insert(incomingShipmentLines).values({id:'hv-line-'+id,shipmentId:'hv-'+id,lineNo:1,sku:'ORDER',unit:'Cái',quantity:2,price:id==='valid'?1000:9000,purchaseDiscount:10,confirmedPurchaseDiscount:20,printFee:50});
 }
 const d=await homeStockValue(f.db,now,homeStockFilters(new URLSearchParams('priceBasis=purchase')));assert.equal(d.totalValue,2540);assert.equal(d.referenceValue,2540);assert.equal(d.missingSkus,1);assert.equal(d.inventory.find(w=>w.id==='hv-sapo')!.pricedSkus,2);
});
const {renderHomeStockValue}=await import(new URL('../../trial-ui/home-stock-value.js',import.meta.url).href);
test('Home stock presentation distinguishes missing data/costs from true zero and escapes warehouse names',()=>{
 const base={filters:homeStockFilters(new URLSearchParams('priceBasis=purchase')),asOf:now,totalValue:0,referenceValue:0,missingSkus:0,pricedRows:0,unknownWarehouses:1,inventory:[{name:'Kho <img src=x onerror=alert(1)>',id:'x',value:0,referenceValue:0,hasStockData:false,missingSkus:0,negativeSkus:0,source:'sapo',updatedAt:null}]};
 const unknown=renderHomeStockValue(base);assert.match(unknown,/Chưa có dữ liệu/);assert.doesNotMatch(unknown,/<img/);assert.doesNotMatch(unknown,/>0 đ<\/strong>/);
 const empty=renderHomeStockValue({...base,unknownWarehouses:0,inventory:[{...base.inventory[0],hasStockData:true}]});assert.match(empty,/>0 đ<\/strong>/);
 const missing=renderHomeStockValue({...base,missingSkus:1,unknownWarehouses:0,inventory:[{...base.inventory[0],hasStockData:true,missingSkus:1}]});assert.match(missing,/Chưa đủ giá nhập/);assert.doesNotMatch(missing,/>0 đ<\/strong>/);
});

test('Default list prices and detailed source filters value only the selected group, deduct good receipts, preserve VAT/list prices and never guess warehouse/unit mappings',async()=>{
 const f=await fixture();
 await f.db.insert(products).values([{sku:'V-A',name:'Hàng A',unit:'Cái',taxable:true,taxOut:8,taxBasis:'Giá đã bao gồm thuế',updatedAt:past},{sku:'V-B',name:'Hàng B',unit:'Cái',updatedAt:past},{sku:'V-FREE',name:'Tặng kèm',unit:'Cái',updatedAt:past}]);
 await f.db.insert(pricePolicies).values([{id:'v-retail',name:'Giá bán lẻ + VAT',sortOrder:5},{id:'v-wholesale',name:'Giá sỉ',sortOrder:0}]);
 await f.db.insert(productPrices).values([{sku:'V-A',policyId:'v-retail',price:1000},{sku:'V-B',policyId:'v-retail',price:100},{sku:'V-FREE',policyId:'v-retail',price:0},{sku:'V-A',policyId:'v-wholesale',price:1}]);
 await f.db.insert(productStock).values([{sku:'V-A',warehouseId:'hv-sapo',quantity:2,updatedAt:past},{sku:'V-FREE',warehouseId:'hv-sapo',quantity:3,updatedAt:past},{sku:'V-A',warehouseId:'hv-supplier',quantity:1000,updatedAt:past},{sku:'V-A',warehouseId:'hv-incoming',quantity:9999,updatedAt:past}]);
 await f.db.insert(productMovements).values({id:'v-cost',refKey:'v-cost',sku:'V-A',kind:'purchase',qty:1,unit:'Cái',unitPrice:100,occurredAt:past,recordedAt:past});
 await f.db.insert(suppliers).values(['a','b'].map(id=>({id:'v-'+id,name:'NCC '+id,nameKey:'v-'+id,createdBy:'mgr',createdAt:past,updatedAt:past})));
 const order=async(id:string,{approval='approved',submitted=now,supplier='a',warehouse='Kho Sapo',confirmation='confirmed',sku='V-A',unit='Cái',qty=10,price=400,due='2026-11-08',cancelled=null,discount=null,confirmedDiscount=null,printFee=0}:any={})=>{
  await f.db.insert(incomingShipments).values({id:'v-'+id,ticketNumber:'V-'+id,source:'supplier-order',approvalStatus:approval,submittedAt:submitted,supplierId:'v-'+supplier,supplierName:'NCC '+supplier,warehouse,supplierStatus:confirmation,arrivalDate:'2026-11-30',cancelledAt:cancelled,createdBy:'mgr',createdAt:past,updatedAt:past});
  await f.db.insert(incomingShipmentLines).values({id:'v-line-'+id,shipmentId:'v-'+id,lineNo:1,sku,unit,quantity:qty,price,purchaseDiscount:discount,confirmedPurchaseDiscount:confirmedDiscount,printFee,promisedDate:due});
 };
 await order('partial',{discount:10,confirmedDiscount:20,printFee:5});await order('boxes',{unit:'Thùng',qty:4,price:900,due:'2026-11-13'});
 await order('unassigned',{supplier:'b',warehouse:'Địa chỉ giao hàng chưa có trong danh mục kho',sku:'V-B',qty:5,price:50,confirmation:'pending',due:'2026-11-15'});
 await order('uncatalogued',{supplier:'b',warehouse:'Địa chỉ khác',sku:'SKU-IMPORTED',qty:2,price:70,confirmation:'pending',due:'2026-11-15'});
 await order('pending',{approval:'pending',qty:8,price:600,confirmation:'pending'});await order('draft',{approval:'pending',submitted:null,qty:100});await order('cancelled',{cancelled:now});await order('full',{qty:2});
 for(const [id,orderId,good,damaged,cancelled] of [['partial','partial',3,2,null],['void','partial',5,0,now],['full','full',2,0,null]] as const){
  await f.db.insert(supplierReceipts).values({id:'v-rc-'+id,receiptNo:'V-RC-'+id,shipmentId:'v-'+orderId,receivedDate:'2026-11-08',receivedBy:'mgr',clientKey:'v-key-'+id,createdAt:past,cancelledAt:cancelled});
  await f.db.insert(supplierReceiptLines).values({receiptId:'v-rc-'+id,lineId:'v-line-'+orderId,sku:'V-A',goodQty:good,damagedQty:damaged});
 }
 const read=async(q='priceBasis=list')=>ok(await f.call('/admin/home-stock-value'+(q?'?'+q:''),f.cookies.mgr));
 const before=await f.client.query('select (select count(*) from stock_moves)::int as moves,(select count(*) from supplier_receipts)::int as receipts');
 const initial=await read();assert.equal(initial.filters.priceBasis,'list');assert.equal(initial.filters.stockType,'physical');assert.equal(initial.pricePolicy.id,'v-retail');assert.equal(initial.totalValue,2000,'raw list amount including stored VAT, never wholesale or cost');assert.equal(initial.inventory.find((w:any)=>w.id==='hv-sapo').pricedSkus,2,'zero list price is valid');
 assert.equal((await read('')).totalValue,200,'already-open legacy Home still gets purchase value for its no-query request');
 assert.equal((await read('priceBasis=purchase&warehouseId=hv-sapo')).totalValue,200);
 const incoming=await read('stockType=incoming');assert.equal(incoming.totalValue,7500);assert.equal(incoming.missingSkus,2,'known unit mismatch and uncatalogued imported SKU stay unpriced at list');assert.equal(incoming.inventory.length,2);assert.equal(incoming.options.suppliers.length,2);assert.equal(incoming.inventory.find((w:any)=>w.id===UNASSIGNED).value,500);
 const purchase=await read('stockType=incoming&priceBasis=purchase');assert.equal(purchase.totalValue,6265,'7×325 + 4×900 + 5×50 + 2×70; no duplicate incoming stock, no damaged or cancelled receipts deduction');assert.equal(purchase.referenceValue,0);assert.equal(purchase.missingSkus,0,'imported SKU can use its own order price');
 assert.equal((await read('stockType=incoming&warehouseId=hv-sapo&supplierId=v-a&confirmation=confirmed&due=late')).totalValue,7000);
 assert.equal((await read('stockType=incoming&supplierId=v-b&confirmation=pending&due=week')).totalValue,500);
 assert.equal((await read('stockType=incoming&warehouseId='+UNASSIGNED)).totalValue,500);
 assert.equal((await read('stockType=incoming&confirmation=confirmed&due=week')).missingSkus,1,'cannot apply per-item list price to a carton');
 assert.equal((await read('stockType=incoming&supplierId=v-b&confirmation=confirmed')).totalValue,0,'empty matching set is a true zero');
 assert.equal((await read('stockType=ordered')).totalValue,8000,'only submitted pending order, no draft, approved, received or cancelled order');
 assert.equal((await read('stockType=ordered&priceBasis=purchase')).totalValue,4800);
 assert.equal((await read('stockType=supplier')).totalValue,1000000);assert.equal((await read('stockType=supplier&priceBasis=purchase')).totalValue,100000);
 for(const q of ['priceBasis=wholesale','stockType=all','confirmation=bogus','due=yesterday','warehouseId=bad','stockType=incoming&supplierId=bad','supplierId=v-a','stockType=supplier&due=late'])ok(await f.call('/admin/home-stock-value?'+q,f.cookies.mgr),400);
 for(const role of ['emp','wh','acct','admin','ncc'])for(const q of ['','stockType=incoming&priceBasis=purchase','stockType=ordered','stockType=supplier'])ok(await f.call('/admin/home-stock-value?'+q,f.cookies[role]),403);
 assert.deepEqual((await f.client.query('select (select count(*) from stock_moves)::int as moves,(select count(*) from supplier_receipts)::int as receipts')).rows,before.rows,'all filtered requests are read only');
});

test('List mode never substitutes a wholesale policy and reports missing retail prices instead of a false zero',async()=>{
 const f=await fixture();await f.db.insert(products).values({sku:'NO-RETAIL',name:'Chỉ có giá sỉ',unit:'Cái',updatedAt:past});await f.db.insert(productStock).values({sku:'NO-RETAIL',warehouseId:'hv-sapo',quantity:4,updatedAt:past});
 await f.db.insert(pricePolicies).values({id:'only-wholesale',name:'Giá sỉ',sortOrder:0});await f.db.insert(productPrices).values({sku:'NO-RETAIL',policyId:'only-wholesale',price:100});
 const d=await homeStockValue(f.db,now);assert.equal(d.pricePolicy,null);assert.equal(d.missingSkus,1);assert.equal(d.pricedRows,0);const html=renderHomeStockValue(d);assert.match(html,/Chưa đủ giá niêm yết/);assert.doesNotMatch(html,/>0 đ<\/strong>/);
});
