import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';
import { emptyCart } from '../../src/modules/sales/api/pos-store.ts';
import { posOrderNote } from '../../src/modules/sales/domain/pos-order-note.ts';

test('Ghi chú POS: giới hạn chuỗi, trim và bill cũ không ghi chú giữ hash đầu vào', () => {
  assert.equal(posOrderNote('  Gói quà\nGiao chiều  '), 'Gói quà\nGiao chiều');
  for (const note of [123, {}, 'x'.repeat(2001)]) assert.throws(() => posOrderNote(note));
  assert.equal('note' in emptyCart({}), false);
  assert.deepEqual(emptyCart({}), emptyCart({ note: '  ' }));
});
test('POS: ghi chú vào preview/đơn/bill/payload; QR giữ hiệu lực khi sửa ghi chú, replay khác ghi chú bị chặn', async () => {
  const f = await setup({ viaClaw: true }), shift = await f.open();
  const initial = f.cart(shift.id, { note: 'Gói quà' });
  const before = await f.call('/pos/preview', f.emp, 'POST', initial);
  assert.equal(before.status, 200); assert.equal(before.data.note, 'Gói quà');
  const qr = await f.call('/pos/qr', f.emp, 'POST', initial);
  assert.equal(qr.status, 200);
  const note = '<script>ghi chú</script>\nGiao sau 17h';
  const body = { ...initial, key: crypto.randomUUID(), note, method: 'transfer', confirmed: true, paymentRequestId: qr.data.id };
  const after = await f.call('/pos/preview', f.emp, 'POST', body);
  assert.equal(after.data.fingerprint, before.data.fingerprint, 'Ghi chú không thay đổi yêu cầu thu tiền');
  const sale = await f.call('/pos/checkout', f.emp, 'POST', body);
  assert.equal(sale.status, 201, JSON.stringify(sale.data)); assert.equal(sale.data.note, note); assert.equal(sale.data.total, 194400);
  const order = (await f.call('/orders/' + sale.data.id, f.mgr)).data.order;
  assert.equal(order.note, note); assert.equal(JSON.parse(order.posSnapshot).note, note);
  assert.equal((await f.call('/pos/bills/' + sale.data.id, f.emp)).data.note, note);
  assert.ok(f.hooks[0]!.body.notes.includes(note));
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', body)).data.replayed, true);
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', { ...body, note: 'Khác' })).status, 409);
  assert.equal((await f.call('/pos/preview', f.emp, 'POST', { ...body, note: ['invalid'] })).status, 400);
  assert.equal((await f.call('/orders/' + sale.data.id + '/pos', f.mgr, 'PUT', { revision: order.revision, reason: 'Bổ sung lời nhắn', note: 'Gọi trước khi giao' })).status, 200);
  const updated = (await f.call('/orders/' + sale.data.id, f.mgr)).data.order;
  assert.equal(updated.note, 'Gọi trước khi giao'); assert.equal(JSON.parse(updated.posSnapshot).note, updated.note);
});

test('POS product notes survive checkout, bill and replay without changing totals', async () => {
 const f=await setup(),shift=await f.open(),base=f.cart(shift.id);
 const note='Gói riêng <b>từng chén</b>';
 const body={...base,rows:base.rows.map(row=>({...row,note})),key:crypto.randomUUID(),method:'cash',tendered:300000};
 const before=await f.call('/pos/preview',f.emp,'POST',base);
 const preview=await f.call('/pos/preview',f.emp,'POST',body);
 assert.equal(preview.status,200);assert.equal(preview.data.lines[0].note,note);assert.equal(preview.data.total,before.data.total);
 const sale=await f.call('/pos/checkout',f.emp,'POST',body);
 assert.equal(sale.status,201,JSON.stringify(sale.data));
 const bill=await f.call('/pos/bills/'+sale.data.id,f.emp);
 assert.equal(bill.data.lines[0].note,note);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',body)).data.replayed,true);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',{...body,rows:body.rows.map(row=>({...row,note:'Khác'}))})).status,409);
 assert.equal((await f.call('/pos/preview',f.emp,'POST',{...body,rows:body.rows.map(row=>({...row,note:'x'.repeat(2001)}))})).status,400);
});
