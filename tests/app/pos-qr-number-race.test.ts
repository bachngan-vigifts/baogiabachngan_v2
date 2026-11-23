// SỐ ĐƠN POS KHỚP NỘI DUNG CHUYỂN KHOẢN KHI CÓ ĐƠN CHEN VÀO.
// Lỗi cũ: QR giữ số POS_..._001; thu ngân tự tích "đã nhận chuyển khoản" trước khi SePay báo về → đơn lưu không gắn QR,
// cấp số mới (bị đẩy lên một số), trong khi khách chuyển khoản ghi số cũ → khoản SePay không khớp đơn.
// Sau: máy chủ gắn đúng QR đang mở của giỏ đó; đơn lấy đúng số trên QR, khoản SePay về sau gắn đúng đơn.
// Kèm: số đơn có mã cửa hàng (POS_LOCK_/POS_ML_) để lọc; ngân hàng bỏ dấu "_" vẫn khớp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { posPaymentRequests } from '../../src/modules/sales/pos-schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { posStoreCode } from '../../src/modules/sales/domain/pos-store-code.ts';
import { nextPosOrderNo, posOrderPrefixFor } from '../../src/modules/sales/api/pos-number.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';
import { posQrOrderNumbers, normalizePosReference, matchesPosQrReference, reservedPosOrderNo } from '../../src/modules/sales/domain/pos-qr-reference.ts';

const orderNo = async (f: Awaited<ReturnType<typeof setup>>, id: string) => (await f.db.select().from(salesOrders).where(eq(salesOrders.id, id)))[0]!.orderNo;

test('đơn tiền mặt chen vào khi QR đang chờ; thu ngân tự xác nhận chuyển khoản → đơn vẫn đúng số trên QR', async () => {
  const f = await setup(), shift = await f.open();
  const cartA = f.cart(shift.id);
  const qr = await f.call('/pos/qr', f.emp, 'POST', cartA); assert.equal(qr.status, 200, JSON.stringify(qr.data));
  // Đơn khác chen vào lúc khách đang quét mã.
  const cash = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { rows: [{ sku: '00123', qty: 1 }] })); assert.equal(cash.status, 201, JSON.stringify(cash.data));
  assert.notEqual(await orderNo(f, cash.data.id), qr.data.orderNo, 'đơn chen vào không lấy số đã giữ cho QR');
  // Thu ngân tích "đã nhận chuyển khoản" khi SePay chưa báo; giao diện cũ không gửi mã QR.
  const saved = await f.call('/pos/checkout', f.emp, 'POST', { ...cartA, key: crypto.randomUUID(), method: 'transfer', confirmed: true });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(await orderNo(f, saved.data.id), qr.data.orderNo, 'đơn giữ đúng số in trên nội dung chuyển khoản');
  const [order] = await f.db.select().from(salesOrders).where(eq(salesOrders.id, saved.data.id));
  assert.equal(order!.posPaymentRequestId, qr.data.id, 'đơn gắn với yêu cầu QR');
  // SePay báo về sau: khớp đúng QR đã gắn đơn, không tạo khoản lơ lửng.
  const r = await f.router.handle(new Request('https://trial.test/api/staff/integrations/sepay/pos-payment', { method: 'POST', headers: { authorization: 'Apikey test-sepay-key', 'content-type': 'application/json' }, body: JSON.stringify({ transferType: 'in', transferAmount: qr.data.amount, accountNumber: '123456', code: 'bank-race', content: qr.data.content.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/_/g, ' ') }) }), f.env);
  const hook = await r.json() as any; assert.equal(r.status, 200, JSON.stringify(hook)); assert.equal(hook.paymentRequestId, qr.data.id); assert.equal(hook.alreadyConfirmed, true);
});

test('không gắn nhầm QR: giỏ khác, tiền mặt, QR hết hạn hoặc QR đã dùng → cấp số mới như cũ', async () => {
  const f = await setup(), shift = await f.open();
  const cartA = f.cart(shift.id), qr = await f.call('/pos/qr', f.emp, 'POST', cartA); assert.equal(qr.status, 200);
  const cash = await f.call('/pos/checkout', f.emp, 'POST', { ...cartA, key: crypto.randomUUID() }); assert.equal(cash.status, 201, JSON.stringify(cash.data));
  assert.notEqual(await orderNo(f, cash.data.id), qr.data.orderNo, 'tiền mặt không lấy QR');
  const other = await f.call('/pos/checkout', f.emp, 'POST', { ...f.cart(shift.id, { rows: [{ sku: '00123', qty: 1 }] }), method: 'transfer', confirmed: true }); assert.equal(other.status, 201, JSON.stringify(other.data));
  assert.notEqual(await orderNo(f, other.data.id), qr.data.orderNo, 'giỏ khác không lấy QR');
  await f.db.update(posPaymentRequests).set({ expiresAt: '2000-01-01T00:00:00Z' }).where(eq(posPaymentRequests.id, qr.data.id));
  const late = await f.call('/pos/checkout', f.emp, 'POST', { ...cartA, key: crypto.randomUUID(), method: 'transfer', confirmed: true }); assert.equal(late.status, 201, JSON.stringify(late.data));
  assert.notEqual(await orderNo(f, late.data.id), qr.data.orderNo, 'QR hết hạn không gắn');
});

test('số đơn POS có mã cửa hàng; ngân hàng bỏ dấu "_" vẫn khớp; đơn cũ không mã vẫn đọc được', async () => {
  assert.equal(posStoreCode('Quầy Lock', 'Kho POS'), 'LOCK');
  assert.equal(posStoreCode('Quầy 1', 'Kho Minh Long Q1'), 'ML');
  assert.equal(posStoreCode('Quầy Minh Long', 'Kho chung Lock & Minh Long'), 'ML', 'kho chung → theo tên quầy');
  assert.equal(posStoreCode('Quầy 1', 'Kho tổng'), null, 'không rõ cửa hàng → không đoán');
  const f = await setup(), shift = await f.open();
  const lock = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id)); assert.equal(lock.status, 201, JSON.stringify(lock.data));
  assert.match(await orderNo(f, lock.data.id), /^POS_LOCK_001_\d{8}$/);
  // Quầy Minh Long đánh số riêng theo cửa hàng (nhân viên Lock không bán được ở quầy ML nên kiểm trực tiếp bộ cấp số).
  await f.db.insert(warehouses).values({ id: 'ml-wh', name: 'Kho Minh Long', kind: 'stock' });
  const date = vietnamDate().iso, prefix = await posOrderPrefixFor(f.db, { name: 'Quầy 1', warehouseId: 'ml-wh' });
  assert.equal(prefix, 'POS_ML');
  const mlNo = await nextPosOrderNo(f.db, date, prefix);
  assert.match(mlNo, /^POS_ML_001_\d{8}$/);
  assert.match(await nextPosOrderNo(f.db, date, 'POS_LOCK'), /^POS_LOCK_002_\d{8}$/, 'Lock đếm tiếp số của Lock');
  const qrLock = await f.call('/pos/qr', f.emp, 'POST', f.cart(shift.id, { rows: [{ sku: '00123', qty: 1 }] })); assert.equal(qrLock.status, 200, JSON.stringify(qrLock.data));
  assert.match(qrLock.data.orderNo, /^POS_LOCK_002_\d{8}$/); assert.equal(qrLock.data.content, 'Thanh toán đơn ' + qrLock.data.orderNo);
  for (const no of [mlNo, qrLock.data.orderNo]) {
    const bank = normalizePosReference('FT123 Thanh toan don ' + no.replace(/_/g, ''));
    assert.deepEqual(posQrOrderNumbers(bank), [no], no);
    assert.ok(matchesPosQrReference({ id: 'x', cart: JSON.stringify({ reservedOrderNo: no }) }, bank));
    assert.equal(matchesPosQrReference({ id: 'x', cart: JSON.stringify({ reservedOrderNo: no }) }, normalizePosReference(no.replace(/_00(\d)_/, '_00$10_'))), false);
  }
  assert.equal(reservedPosOrderNo(JSON.stringify({ reservedOrderNo: 'POS_005_23112026' })), 'POS_005_23112026', 'số cũ không mã vẫn đọc được');
  assert.equal(reservedPosOrderNo(JSON.stringify({ reservedOrderNo: 'POS_XX_005_23112026' })), null);
  assert.deepEqual(posQrOrderNumbers(normalizePosReference('Thanh toan don POS 005 23112026')).includes('POS_005_23112026'), true);
});
