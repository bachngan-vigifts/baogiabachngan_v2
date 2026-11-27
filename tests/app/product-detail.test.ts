import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sql,eq} from 'drizzle-orm';
import {supplierOrderSources} from '../../src/modules/suppliers/schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {posReturns,posReturnLines} from '../../src/modules/sales/return-schema.ts';
import {productDetailFixture} from '../helpers/product-detail-fixture.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('product overview uses all scoped source documents, nets effective returns, excludes draft/cancelled and never counts contracts twice',async()=>{
 const f=await productDetailFixture(),before=(await f.client.query<{n:number}>('select count(*)::int n from stock_moves')).rows[0]!.n;
 const d=ok(await f.call('/products/'+f.sku+'/overview',f.cookies.mgr));
 assert.equal(d.stats.sales.count,3);assert.equal(Number(d.stats.sales.qty),9);assert.equal(Number(d.stats.sales.revenue),900);assert.equal(Number(d.stats.returns.qty),1);assert.equal(Number(d.stats.returns.amount),100);
 assert.equal(d.stats.receipts.count,1);assert.equal(Number(d.stats.receipts.qty),5);assert.equal(Number(d.stats.receipts.damaged),1);
 assert.equal(d.documents.find((r:any)=>r.kind==='quotes').total,28);assert.equal(d.documents.find((r:any)=>r.kind==='contracts').total,1);assert.equal(d.product.perCarton,12);assert.deepEqual(d.barcodes,['8931234567890']);assert.equal(d.prices[0].price,108);assert.ok(d.stock.some((w:any)=>w.id==='private'));
 assert.equal(d.profit.averagePerUnit,40);assert.equal(d.profit.quantity,56);assert.equal(d.profit.estimatedProfit,2240);
 const first=ok(await f.call('/products/'+f.sku+'/documents?kind=quotes',f.cookies.mgr)),next=ok(await f.call('/products/'+f.sku+'/documents?kind=quotes&offset=25',f.cookies.mgr));assert.equal(first.total,28);assert.equal(first.rows.length,25);assert.equal(next.rows.length,3);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.id)).size,28);assert.ok(first.rows.every((r:any)=>r.amount===200));
 const contracts=ok(await f.call('/products/'+f.sku+'/documents?kind=contracts',f.cookies.mgr));assert.equal(contracts.rows[0].href,'#/contracts/contract');
 const receipts=ok(await f.call('/products/'+f.sku+'/documents?kind=receipts',f.cookies.mgr));assert.equal(receipts.total,2);assert.equal(receipts.rows.find((r:any)=>r.id==='receipt').href,'#/purchases/a1');
 const now='2026-10-27T06:00:00Z';await f.db.insert(posReturns).values({id:'cancelled-credit',returnNo:'TH-cancelled-fixture',source:'crm',orderId:'cancelled',warehouseId:'public',requestContext:'after_delivery',kind:'return',status:'completed',reason:'Fixture',subtotal:100,total:100,sourceSnapshot:'{}',requestKey:'fixture-cancelled-credit',createdBy:'mgr',createdAt:now,updatedAt:now,creditEffectiveAt:now});await f.db.insert(posReturnLines).values({id:'cancelled-return-line',returnId:'cancelled-credit',orderLineId:'ol-cancelled',sku:f.sku,name:'Sản phẩm',unit:'Bộ',requestedQty:1,receivedQty:1,restockQty:1,disposition:'restock',subtotal:100,tax:0,total:100});
 assert.equal(Number(ok(await f.call('/products/'+f.sku+'/overview',f.cookies.mgr)).stats.returns.amount),100,'do not subtract returns from an already-excluded cancelled sale twice');
 assert.equal((await f.client.query<{n:number}>('select count(*)::int n from stock_moves')).rows[0]!.n,before);
 await f.db.execute(sql`update pos_return_lines set received_qty=0,restock_qty=0 where id='return-line'`);assert.equal(Number(ok(await f.call('/products/'+f.sku+'/overview',f.cookies.mgr)).stats.returns.qty),1,'effective credit uses credited quantity, including before physical receipt');
});
test('product histories preserve quote/order scope, purchase price masking, private warehouses and staff-only access',async()=>{
 const f=await productDetailFixture(),d=ok(await f.call('/products/'+f.sku+'/overview',f.cookies.emp));
 assert.equal(d.profit,null);assert.equal(d.access.profit,false);assert.equal(d.stats.sales.count,1);assert.equal(Number(d.stats.sales.qty),2);assert.equal(d.documents.find((r:any)=>r.kind==='quotes').total,27);assert.ok(!d.stock.some((w:any)=>w.id==='private'));
 const orders=ok(await f.call('/products/'+f.sku+'/documents?kind=orders',f.cookies.emp));assert.ok(!orders.rows.some((r:any)=>r.id==='secret'));assert.ok(!JSON.stringify(d).includes('costPrice'));
 assert.equal((await f.call('/products/'+f.sku+'/documents?kind=purchases',f.cookies.emp)).status,403);
 await f.db.execute(sql`delete from staff_position_permissions where position_id='accounting' and permission='purchases.prices'`);
 const purchases=ok(await f.call('/products/'+f.sku+'/documents?kind=purchases',f.cookies.kt));assert.ok(purchases.rows.length>0);assert.ok(purchases.rows.every((r:any)=>r.amount===null&&!('purchaseRows'in r)));
 const kho=ok(await f.call('/products/'+f.sku+'/overview',f.cookies.kho));assert.deepEqual(kho.prices,[]);assert.equal(kho.stats.sales,null);assert.equal(kho.profit,null);assert.ok(!kho.documents.some((r:any)=>r.kind==='quotes'));assert.equal((await f.call('/products/'+f.sku+'/documents?kind=quotes',f.cookies.kho)).status,403);
 assert.equal((await f.call('/products/'+f.sku+'/overview',f.cookies.ncc)).status,403);assert.equal((await f.call('/products/'+f.sku+'/overview')).status,401);
 await f.db.execute(sql`delete from staff_position_permissions where position_id='sale' and permission='page.purchases'`);
 assert.equal((await f.call('/products/'+f.sku+'/documents?kind=purchases',f.cookies.emp)).status,403);
});
test('product detail endpoints reject invalid paging, unknown kinds and missing products',async()=>{
 const f=await productDetailFixture();for(const q of ['kind=bad','kind=orders&offset=-1','kind=orders&offset=NaN','kind=orders&offset=0.5'])assert.equal((await f.call('/products/'+f.sku+'/documents?'+q,f.cookies.mgr)).status,400);
 assert.equal((await f.call('/products/not-present/overview',f.cookies.mgr)).status,404);assert.equal((await f.call('/products/not-present/documents?kind=orders',f.cookies.mgr)).status,404);
});

test('purchase/receipt histories show purchase number and permission-filtered origin/converted contract links',async()=>{
 const f=await productDetailFixture(),now='2026-10-28T00:00:00Z';
 await f.db.update(salesOrders).set({quoteId:'quote-0'}).where(eq(salesOrders.id,'contract'));
 await f.db.insert(supplierOrderSources).values([
  {id:'source-visible',shipmentId:'a1',lineId:'line-a1',sourceType:'quote',sourceId:'quote-0',sourceNo:'BG-000',customerName:'Khách',sku:f.sku,quantity:2,createdAt:now},
  {id:'source-secret',shipmentId:'a1',lineId:'line-a1',sourceType:'order',sourceId:'secret',sourceNo:'DH-secret',customerName:'Khách kín',sku:f.sku,quantity:1,createdAt:now}
 ]);
 const receipts=ok(await f.call('/products/'+f.sku+'/documents?kind=receipts',f.cookies.mgr)),receipt=receipts.rows.find((r:any)=>r.id==='receipt');
 assert.ok(receipt.purchaseNumber);assert.equal(receipt.purchaseId,'a1');assert.ok(receipt.sources.some((s:any)=>s.href==='#/quotes/quote-0'));assert.ok(receipt.sources.some((s:any)=>s.href==='#/contracts/contract'));
 assert.equal((await f.call('/products/'+f.sku+'/documents?kind=purchases',f.cookies.emp)).status,403);
 await f.db.execute(sql`delete from staff_position_permissions where position_id='accounting' and permission in ('page.orders','page.contracts')`);
 const limited=ok(await f.call('/products/'+f.sku+'/documents?kind=purchases',f.cookies.kt));assert.deepEqual(limited.rows.find((r:any)=>r.id==='a1').sources,[],'quyền mua không tự mở các nguồn báo giá/đơn bị tắt quyền trang');assert.ok(!JSON.stringify(limited).includes('DH-secret'));assert.ok(!JSON.stringify(limited).includes('HĐKT-fixture'));
 assert.equal((await f.call('/products/'+f.sku+'/documents?kind=receipts',f.cookies.kho)).status,403,'Kho nhận qua DTO riêng, không đọc nguồn báo giá/đơn từ product hub');
});

test('quote history lists distinct internal suppliers for the requested SKU without a purchase order',async()=>{
 const f=await productDetailFixture(),path='/products/'+f.sku+'/documents?kind=quotes';
 const rows=[{sku:f.sku,supplierInfo:' NCC A '},{sku:f.sku,supplierInfo:'NCC A'},{sku:f.sku,supplierInfo:'NCC B'},{sku:'other',supplierInfo:'Khác'}];
 await f.db.execute(sql`update staff_quotations set quote_date='2027-01-01', data=${JSON.stringify({template:'sale',rows})} where id='quote-0'`);
 const manager=ok(await f.call(path,f.cookies.mgr)).rows.find((r:any)=>r.id==='quote-0');
 assert.deepEqual(manager.suppliers,['NCC A','NCC B']);
 const employee=ok(await f.call(path,f.cookies.emp)).rows.find((r:any)=>r.id==='quote-0');
 assert.ok(employee);assert.equal(Object.hasOwn(employee,'suppliers'),false);
});
