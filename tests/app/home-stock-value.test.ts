import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {beforeEach,afterEach,mock} from 'node:test';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {products,warehouses,productStock,productMovements,pricePolicies,productPrices} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {orderStockHolds} from '../../src/modules/sales/schema.ts';
import {incomingShipments,incomingShipmentLines,suppliers} from '../../src/modules/suppliers/schema.ts';
import {homeStockValue} from '../../src/app/home-stock-value.ts';
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
 const before=await f.client.query('select count(*)::int as n from stock_moves');const d=ok(await f.call('/admin/home-stock-value',f.cookies.mgr));
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
 const d=await homeStockValue(f.db,now);assert.equal(d.totalValue,2540);assert.equal(d.referenceValue,2540);assert.equal(d.missingSkus,1);assert.equal(d.inventory.find(w=>w.id==='hv-sapo')!.pricedSkus,2);
});
const {renderHomeStockValue}=await import(new URL('../../trial-ui/home-stock-value.js',import.meta.url).href);
test('Home stock presentation distinguishes missing data/costs from true zero and escapes warehouse names',()=>{
 const base={asOf:now,totalValue:0,referenceValue:0,missingSkus:0,pricedRows:0,unknownWarehouses:1,inventory:[{name:'Kho <img src=x onerror=alert(1)>',id:'x',value:0,referenceValue:0,hasStockData:false,missingSkus:0,negativeSkus:0,source:'sapo',updatedAt:null}]};
 const unknown=renderHomeStockValue(base);assert.match(unknown,/Chưa có dữ liệu/);assert.doesNotMatch(unknown,/<img/);assert.doesNotMatch(unknown,/>0 đ<\/strong>/);
 const empty=renderHomeStockValue({...base,unknownWarehouses:0,inventory:[{...base.inventory[0],hasStockData:true}]});assert.match(empty,/>0 đ<\/strong>/);
 const missing=renderHomeStockValue({...base,missingSkus:1,unknownWarehouses:0,inventory:[{...base.inventory[0],hasStockData:true,missingSkus:1}]});assert.match(missing,/Chưa đủ giá mua/);assert.doesNotMatch(missing,/>0 đ<\/strong>/);
});
