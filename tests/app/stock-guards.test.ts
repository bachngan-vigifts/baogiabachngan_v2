import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import { postMoves, reverseRef, type MoveInput } from '../../src/modules/inventory/api/ledger.ts';
import { incomingShipments, incomingShipmentLines, supplierReceipts, suppliers } from '../../src/modules/suppliers/schema.ts';
import { salesOrders, salesOrderLines, packingSlips, packingSlipLines, packingSlipPhotos } from '../../src/modules/sales/schema.ts';
import { setup as setupPos } from '../helpers/pos-fixture.ts';
const at = '2026-10-01T00:00:00.000Z';
async function fixture(open = true) {
  const f = await createTestDb(); await seedStaff(f.d1);
  await f.db.insert(warehouses).values([{ id: 'a', name: 'Kho A', kind: 'stock' }, { id: 'b', name: 'Kho B', kind: 'stock' }]);
  await f.db.insert(products).values(['X','Y'].map(sku => ({sku, name: sku, unit: 'cái', updatedAt: at})));
  await f.db.insert(productStock).values(['a','b'].map(warehouseId => ({sku:'X', warehouseId, quantity:10, updatedAt:at})));
  if (open) await postMoves(f.db, 'mgr', ['a','b'].map(warehouseId => ({sku:'X',warehouseId,qty:10,kind:'opening',refType:'opening',refId:'op'})), at);
  const router = createAppRouter();
  const call = async (path:string,cookie='',method='GET',body?:unknown) => {
    const r = await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db:f.db,passwordIterations:1000,sapoOrderPush:'off'} as never);
    return {status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
  };
  const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
  const counts=async()=> (await f.client.query('select (select count(*)::int from stock_moves) as moves,(select count(*)::int from stock_balances) as balances,(select count(*)::int from supplier_receipts) as receipts,(select count(*)::int from packing_slip_photos) as photos')).rows;
  const snapshot=async()=>({counts:await counts(),balances:await f.db.select().from(stockBalances),orders:await f.db.select().from(salesOrders),slips:await f.db.select().from(packingSlips),receipts:await f.db.select().from(supplierReceipts)});
  return {...f,call,mgr,counts,snapshot};
}
const move=(qty:number, extra:Partial<MoveInput>={}):MoveInput=>({sku:'X',warehouseId:'a',qty,kind:'adjust',refType:'adjustment',refId:crypto.randomUUID(),...extra});
const rejectsCode=(code:string)=>(e:any)=>e.status===409&&e.code===code;
async function seedReceipt(f:Awaited<ReturnType<typeof fixture>>) {
  await f.db.insert(suppliers).values({id:'s',name:'NCC',nameKey:'ncc',createdAt:at,updatedAt:at,createdBy:'mgr'});
  await f.db.insert(incomingShipments).values({id:'po',ticketNumber:'PO-test',source:'supplier-order',warehouse:'Địa chỉ giao, không phải kho',supplierId:'s',supplierName:'NCC',approvalStatus:'approved',supplierStatus:'confirmed',createdAt:at,updatedAt:at,createdBy:'mgr'});
  await f.db.insert(incomingShipmentLines).values({id:'pl',shipmentId:'po',lineNo:1,sku:'X',name:'X',unit:'cái',quantity:10});
  return {clientKey:'receipt-guard-01',warehouse:'Kho A',receivedDate:'2026-10-01',lines:[{lineId:'pl',goodQty:4}]};
}
async function seedOrder(f:Awaited<ReturnType<typeof fixture>>, status:'draft'|'confirmed'='draft', warehouseId:string|null='a', qty=3) {
  await f.db.insert(salesOrders).values({id:'o',orderNo:'DH-test',quoteType:'B2B',orderDate:'2026-10-01',customerName:'Khách',createdBy:'mgr',ownerId:'mgr',createdAt:at,updatedAt:at,status,warehouseId});
  await f.db.insert(salesOrderLines).values({id:'ol',orderId:'o',lineNo:1,sku:'X',name:'X',unit:'cái',qty,unitPrice:100});
}
async function seedSlip(f:Awaited<ReturnType<typeof fixture>>,qty=3) {
  await seedOrder(f,'confirmed',null,qty);
  await f.db.insert(packingSlips).values({id:'p',slipNo:'PDG-test',orderId:'o',source:'warehouse',status:'sent',createdBy:'mgr',sentBy:'mgr',createdAt:at,updatedAt:at});
  await f.db.insert(packingSlipLines).values({id:'psl',slipId:'p',orderLineId:'ol',sku:'X',name:'X',unit:'cái',qty});
}
const photo='data:image/jpeg;base64,'+'A'.repeat(200);

test('postMoves: mọi loại ngoài opening bị chặn trước chốt, kể cả batch có opening hoặc kho đã mở',async()=>{
  const f=await fixture(false),before=await f.snapshot();
  const adjusted=await f.call('/inventory/adjustments',f.mgr,'POST',{warehouseId:'a',reason:'Kiểm kê',lines:[{sku:'X',qty:1}]});
  assert.equal(adjusted.status,409);assert.equal(adjusted.data.code,'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.snapshot(),before);
  for(const [kind,refType] of [['receipt','supplier_receipt'],['issue','packing_slip'],['adjust','adjustment'],['transfer_in','stock_transfer'],['sale','sales_order'],['customer_return','pos_return'],['reverse','supplier_receipt']] as const) {
    await assert.rejects(postMoves(f.db,'mgr',[move(1,{kind,refType})]),rejectsCode('WAREHOUSE_NOT_OPENED'));
    assert.deepEqual(await f.snapshot(),before);
  }
  await assert.rejects(postMoves(f.db,'mgr',[move(10,{kind:'opening',refType:'opening'}),move(-1)]),rejectsCode('WAREHOUSE_NOT_OPENED'));
  await postMoves(f.db,'mgr',[move(10,{kind:'opening',refType:'opening'})]);
  const oneOpened=await f.snapshot();
  await assert.rejects(postMoves(f.db,'mgr',[move(1),move(1,{warehouseId:'b'})]),rejectsCode('WAREHOUSE_NOT_OPENED'));
  assert.deepEqual(await f.snapshot(),oneOpened);
});

test('điều chỉnh âm: kiểm tổng delta cùng mã, rollback cả dòng dương và số dư mới',async()=>{
  const f=await fixture(),before=await f.snapshot();
  const r=await f.call('/inventory/adjustments',f.mgr,'POST',{warehouseId:'a',reason:'Kiểm kê',lines:[{sku:'Y',qty:5},{sku:'X',qty:-6},{sku:'X',qty:-5}]});
  assert.equal(r.status,409);assert.equal(r.data.code,'STOCK_SHORT');assert.match(r.data.error,/X.*còn 10.*cần 11/);
  assert.deepEqual(await f.snapshot(),before);
  await postMoves(f.db,'mgr',[move(-12),move(2)]);
  assert.equal((await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'a')))[0]!.qty,0);
});

test('postMoves/reverseRef: idempotency, nhiều chứng từ cùng mã, reverse thiếu tồn rollback',async()=>{
  const f=await fixture();
  const m=move(5,{kind:'receipt',refType:'supplier_receipt',refId:'r'});
  assert.equal(await postMoves(f.db,'mgr',[m,m]),1); // Same document merges once, quantity 10.
  assert.equal(await postMoves(f.db,'mgr',[m,m]),0);
  await postMoves(f.db,'mgr',[move(-15)]);
  const before=await f.snapshot();
  await assert.rejects(reverseRef(f.db,'mgr','supplier_receipt','r','Huỷ phiếu'),rejectsCode('STOCK_SHORT'));
  assert.deepEqual(await f.snapshot(),before);
  await postMoves(f.db,'mgr',[move(10)]);
  assert.equal(await reverseRef(f.db,'mgr','supplier_receipt','r','Huỷ phiếu'),1);
  assert.equal(await reverseRef(f.db,'mgr','supplier_receipt','r','Huỷ phiếu'),0);
});

test('nhận NCC: kho chưa mở / kho lạ / kho trống không lưu phiếu, không dùng địa chỉ đơn làm fallback',async()=>{
  const f=await fixture(false),body=await seedReceipt(f),before=await f.snapshot();
  for(const warehouse of ['','Không có']) {const r=await f.call('/purchase-orders/po/receipts',f.mgr,'POST',{...body,warehouse});assert.equal(r.status,400,JSON.stringify(r.data));assert.deepEqual(await f.snapshot(),before);}
  const r=await f.call('/purchase-orders/po/receipts',f.mgr,'POST',body);assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.snapshot(),before);
});

test('huỷ phiếu nhận: hàng đã đi tiếp bị chặn; đủ tồn huỷ được và không cộng/trừ lại khi replay',async()=>{
  const f=await fixture(),body=await seedReceipt(f);
  const r=await f.call('/purchase-orders/po/receipts',f.mgr,'POST',body);assert.equal(r.status,201,JSON.stringify(r.data));
  await postMoves(f.db,'mgr',[move(-12)]);const before=await f.snapshot();
  const path='/supplier-receipts/'+r.data.receiptId+'/cancel';
  const denied=await f.call(path,f.mgr,'POST',{reason:'Nhập nhầm'});assert.equal(denied.status,409);assert.equal(denied.data.code,'STOCK_SHORT');assert.deepEqual(await f.snapshot(),before);
  await postMoves(f.db,'mgr',[move(2)]);
  assert.equal((await f.call(path,f.mgr,'POST',{reason:'Nhập nhầm'})).status,200);
  const done=await f.snapshot();assert.equal((await f.call(path,f.mgr,'POST',{reason:'Nhập nhầm'})).status,200);assert.deepEqual(await f.snapshot(),done);
});

for(const opened of [false,true]) test(`đóng gói CRM nguồn kho: ${opened?'vượt tồn':'chưa chốt'} không đổi phiếu/ảnh/sổ`,async()=>{
  const f=await fixture(opened);await seedSlip(f,11);const before=await f.snapshot();
  const r=await f.call('/packing/p/confirm',f.mgr,'POST',{warehouseId:'a',photos:[photo]});
  assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,opened?'STOCK_SHORT':'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.snapshot(),before);
});

test('đóng gói CRM đủ tồn: ghi đúng một lần; điều chỉnh dương vẫn hoạt động',async()=>{
  const f=await fixture();await seedSlip(f,3);
  assert.equal((await f.call('/packing/p/confirm',f.mgr,'POST',{warehouseId:'a',photos:[photo]})).status,200);
  assert.equal((await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'a')))[0]!.qty,7);
  assert.equal((await f.db.select().from(packingSlipPhotos)).length,1);
  assert.equal((await f.call('/inventory/adjustments',f.mgr,'POST',{warehouseId:'a',reason:'Kiểm kê',lines:[{sku:'X',qty:1}]})).status,201);
});

for(const opened of [false,true]) test(`duyệt đơn CRM: ${opened?'vượt tồn':'chưa chốt'} rollback trạng thái`,async()=>{
  const f=await fixture(opened);await seedOrder(f,'draft','a',11);const before=await f.snapshot();
  const r=await f.call('/orders/o/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true});
  assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,opened?'STOCK_SHORT':'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.snapshot(),before);
});

test('điều chuyển done: cả kho đi và đến phải mở, phiếu và hai kho rollback',async()=>{
  const f=await fixture(false);
  const made=await f.call('/stock-transfers',f.mgr,'POST',{fromWarehouseId:'a',toWarehouseId:'b',reason:'Xin hàng',lines:[{sku:'X',qty:1}]});assert.equal(made.status,201,JSON.stringify(made.data));
  const id=made.data.id;assert.equal((await f.call(`/stock-transfers/${id}/approve`,f.mgr,'POST',{})).status,200);
  const before=await f.snapshot();const r=await f.call(`/stock-transfers/${id}/done`,f.mgr,'POST',{});
  assert.equal(r.status,409);assert.equal(r.data.code,'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.snapshot(),before);
  assert.equal((await f.call('/stock-transfers/'+id,f.mgr)).data.status,'approved');
});

test('POS bán quầy chưa chốt: lỗi rõ WAREHOUSE_NOT_OPENED và không tạo đơn/thu tiền',async()=>{
  const f=await setupPos();const shift=await f.open();
  // Simulate a historical open cash shift whose warehouse has never been initialised.
  await f.db.delete(stockMoves);await f.db.delete(stockBalances);
  const before=await f.db.select().from(salesOrders);
  const r=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id));
  assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,'WAREHOUSE_NOT_OPENED');assert.deepEqual(await f.db.select().from(salesOrders),before);
  assert.equal((await f.db.select().from(stockMoves)).length,0);assert.equal((await f.db.select().from(stockBalances)).length,0);
});

test('hai lần xuất cuối cùng trên harness PGlite nối tiếp: chỉ một thành công',async()=>{
  const f=await fixture();const r=await Promise.allSettled([postMoves(f.db,'mgr',[move(-10)]),postMoves(f.db,'mgr',[move(-10)])]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);
  assert.equal((await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'a')))[0]!.qty,0);
});
test('hai kết nối PostgreSQL đồng thời tranh tồn cuối (FOR UPDATE thực)',{skip:'Harness PGlite chỉ có một connection, tuần tự hoá transaction. Docker socket không được cấp quyền; chưa kiểm thử cạnh tranh hai kết nối thật.'},()=>{});
