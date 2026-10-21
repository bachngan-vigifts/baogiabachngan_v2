import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { employees, positions, positionPermissions } from '../../src/modules/staff/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { posRegisters, posShifts } from '../../src/modules/sales/pos-schema.ts';
import { customerPayments, salesOrders, deliveries } from '../../src/modules/sales/schema.ts';
const ok = (r: any, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
async function store(f: Awaited<ReturnType<typeof setup>>, positionId: string) {
  await f.db.update(employees).set({ positionId }).where(eq(employees.id, 'emp'));
  await f.db.update(employees).set({ positionId }).where(eq(employees.id, 'cashier2'));
  await f.db.update(warehouses).set({ name: 'MINH LONG - LOCKNLOCK CẦN THƠ' }).where(eq(warehouses.id, 'pos-wh'));
  await f.db.update(posRegisters).set({ name: positionId === 'sales-lock' ? 'CỬA HÀNG LOCKNLOCK CẦN THƠ' : 'Showroom Gốm Sứ Minh Long Cần Thơ' }).where(eq(posRegisters.id, f.registerId));
}
for (const position of ['sales-lock','sales-ml']) test(`Ca chung ${position}: cùng cửa hàng thấy ca và bán/QR/COD, ghi đúng NV; không thêm quyền kết ca/báo cáo`, async () => {
  const f = await setup(); await store(f,position); const s = await f.open();
  const owner = ok(await f.call('/pos/options',f.emp)), peer = ok(await f.call('/pos/options',f.other));
  assert.equal(owner.canCloseCurrent,true); assert.equal(peer.current.id,s.id); assert.equal(peer.canCloseCurrent,false); assert.ok(peer.current.memberName); assert.equal(peer.current.openingCash,undefined,'không mở quyền xem tiền đầu ca qua options');
  assert.equal(peer.shifts.some((x:any)=>x.id===s.id),false,'không lẫn lịch sử riêng vào ca dùng chung');
  const b = f.cart(s.id); const preview = ok(await f.call('/pos/preview',f.other,'POST',b)); assert.equal(preview.memberName,'Cashier 2');
  const qr = ok(await f.call('/pos/qr',f.other,'POST',f.cart(s.id))); ok(await f.call('/pos/qr/'+qr.id+'/status',f.other));
  const [peerSale, ownSale] = await Promise.all([f.call('/pos/checkout',f.other,'POST',b), f.call('/pos/checkout',f.emp,'POST',f.cart(s.id))]);
  const sale = ok(peerSale,201); ok(ownSale,201);
  assert.equal(sale.memberName,'Cashier 2');
  const [o] = await f.db.select().from(salesOrders).where(eq(salesOrders.id,sale.id));
  assert.equal(o!.ownerId,'cashier2'); assert.equal(o!.createdBy,'cashier2'); assert.equal(o!.shiftId,s.id);
  const [p] = await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,sale.id));
  assert.equal(p!.createdBy,'cashier2'); assert.equal(p!.shiftId,s.id);
  assert.equal((await f.db.select().from(posShifts)).length,1);
  ok(await f.call('/pos/bills/'+sale.id,f.other));
  assert.equal((await f.call('/pos/shifts/'+s.id,f.other)).status,404);
  for(const path of ['/pos/shifts/'+s.id+'/close','/cash/shifts/'+s.id+'/close']) assert.equal((await f.call(path,f.other,'POST',{countedCash:888800})).status,404);
  assert.equal(ok(await f.call('/pos/shifts/'+s.id,f.emp)).cash,388800,'bán chung cộng vào đúng ca/két');
  ok(await f.call('/pos/cod?shiftId='+s.id,f.other));
  ok(await f.call('/pos/order-flows?shiftId='+s.id,f.other));
  ok(await f.call('/pos/shifts/'+s.id+'/close',f.emp,'POST',{countedCash:888800}));
  assert.equal(ok(await f.call('/pos/options',f.other)).current,null);
  assert.equal((await f.call('/pos/preview',f.other,'POST',b)).status,409);
  assert.equal((await f.call('/pos/checkout',f.other,'POST',f.cart(s.id))).status,409);
  ok(await f.call('/pos/bills/'+sale.id,f.other));
});

test('Ca chung: từ chối NVBH khác cửa hàng, vai trò không gán cửa hàng, người bị thu quyền và ca không rõ quầy', async () => {
  const f = await setup(); await store(f,'sales-lock'); const s = await f.open();
  await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'cashier2'));
  assert.equal(ok(await f.call('/pos/options',f.other)).current,null);
  for(const path of ['/pos/preview','/pos/qr','/pos/checkout']) assert.equal((await f.call(path,f.other,'POST',f.cart(s.id))).status,403);
  await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'cashier2'));
  assert.equal(ok(await f.call('/pos/options',f.other)).current,null);
  assert.equal((await f.call('/pos/preview',f.other,'POST',f.cart(s.id))).status,404);
  await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'cashier2'));
  await f.db.update(posRegisters).set({name:'Quầy chưa phân loại'}).where(eq(posRegisters.id,f.registerId));
  assert.equal(ok(await f.call('/pos/options',f.other)).current,null);
  assert.equal((await f.call('/pos/preview',f.other,'POST',f.cart(s.id))).status,403);
  await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
  await f.db.delete(positionPermissions).where(eq(positionPermissions.positionId,'sales-lock'));
  assert.equal((await f.call('/pos/preview',f.other,'POST',f.cart(s.id))).status,403);
});

test('CHT được nhận diện theo chức vụ, không dựa tên nhân viên; Manager không tự có quyền bán trong ca người khác', async () => {
  const f = await setup(); await store(f,'sales-lock'); const s = await f.open();
  await f.db.insert(positions).values({id:'cht-lock-test',name:'CHT LOCK'});
  await f.db.insert(positionPermissions).values({positionId:'cht-lock-test',permission:'pos.sell'});
  await f.db.update(employees).set({positionId:'cht-lock-test',name:'Tên không chứa Lock'}).where(eq(employees.id,'cashier2'));
  assert.equal(ok(await f.call('/pos/options',f.other)).current.id,s.id);
  ok(await f.call('/pos/preview',f.other,'POST',f.cart(s.id)));
  assert.equal((await f.call('/pos/preview',f.mgr,'POST',f.cart(s.id))).status,404);
  ok(await f.call('/pos/shifts/'+s.id,f.mgr));
});

test('Ca chung: đồng nghiệp thu nốt cọc và COD trong ca của người mở, phiếu thu ghi người thực thu', async () => {
  const f=await setup(); await store(f,'sales-lock'); const s=await f.open();
  const deposit=ok(await f.call('/pos/order-flows/checkout',f.emp,'POST',f.cart(s.id,{saleFlow:'deposit'})),201);
  const collect={key:crypto.randomUUID(),shiftId:s.id,amount:136080,method:'cash',pickup:true};
  ok(await f.call('/pos/order-flows/'+deposit.id+'/collect',f.other,'POST',collect),201);
  const [balance]=await f.db.select().from(customerPayments).where(eq(customerPayments.requestKey,collect.key));
  assert.equal(balance!.createdBy,'cashier2'); assert.equal(balance!.shiftId,s.id);
  const cod=ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id,{fulfillmentMode:'cod',delivery:{address:'Địa chỉ thử'}})),201);
  const [delivery]=await f.db.select().from(deliveries).where(eq(deliveries.orderId,cod.id));
  await f.db.update(deliveries).set({status:'delivered',deliveredAt:new Date().toISOString()}).where(eq(deliveries.id,delivery!.id));
  const codCollect={key:crypto.randomUUID(),shiftId:s.id,method:'cash',confirmed:true};
  ok(await f.call('/pos/cod/'+delivery!.id+'/collect',f.other,'POST',codCollect),201);
  ok(await f.call('/pos/cod/'+delivery!.id+'/collect',f.other,'POST',codCollect),201);
  const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.requestKey,codCollect.key));
  assert.equal(receipts.length,1); assert.equal(receipts[0]!.createdBy,'cashier2'); assert.equal(receipts[0]!.shiftId,s.id);
  assert.equal(ok(await f.call('/pos/shifts/'+s.id,f.emp)).cash,388800);
});
