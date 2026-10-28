import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import { salesOrders, deliveries } from '../../src/modules/sales/schema.ts';
import { posReturns } from '../../src/modules/sales/return-schema.ts';
import { incomingShipments, supplierReceipts, suppliers } from '../../src/modules/suppliers/schema.ts';
import { setup as setupPos } from '../helpers/pos-fixture.ts';

/**
 * SỔ KHO THEO TỪNG KHO: chốt tồn đầu kỳ, trạng thái, nguồn tồn Tra tồn, đối chiếu Sapo đều xét riêng từng kho.
 * Kho A: 3 mã sạch. Kho B: rỗng (không có tồn Sapo) hoặc có mã âm.
 */
const origin = 'https://trial.test', at = '2026-10-01T00:00:00.000Z';
async function setup(b: 'empty' | 'negative') {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(warehouses).values([{ id: 'a', name: 'Kho A', kind: 'stock', sortOrder: 0 }, { id: 'b', name: 'Kho B', kind: 'stock', sortOrder: 1 }]);
  await db.insert(products).values(['S1', 'S2', 'S3'].map(sku => ({ sku, name: 'Hàng ' + sku, unit: 'cái', updatedAt: at })));
  await db.insert(productStock).values([{ sku: 'S1', warehouseId: 'a', quantity: 5, updatedAt: at }, { sku: 'S2', warehouseId: 'a', quantity: 7, updatedAt: at }, { sku: 'S3', warehouseId: 'a', quantity: 9, updatedAt: at }]);
  if (b === 'negative') await db.insert(productStock).values([{ sku: 'S1', warehouseId: 'b', quantity: -3, updatedAt: at }, { sku: 'S2', warehouseId: 'b', quantity: 4, updatedAt: at }]);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' } as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  return { db, call, mgr, emp };
}

test('chốt "Tất cả kho": A chốt được, B rỗng báo lỗi riêng; trạng thái, Tra tồn, đối chiếu đều theo từng kho', async () => {
  const { db, call, mgr, emp } = await setup('empty');
  const r = await call('/inventory/opening', mgr, 'POST', { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.ok, false); assert.equal(r.data.lines, 3);
  assert.deepEqual(r.data.results.map((x: any) => [x.warehouseId, x.name, x.status, x.lines]), [['a', 'Kho A', 'opened', 3], ['b', 'Kho B', 'failed', 0]]);
  assert.equal(r.data.results[1].message, 'Kho "Kho B" không có tồn Sapo để chốt. Kiểm tra lại danh mục tồn Sapo của kho này.');
  assert.doesNotMatch(JSON.stringify(r.data), /marker|migration/i);

  // Trạng thái theo kho đang chọn.
  const sa = (await call('/inventory/status?warehouseId=a', mgr)).data, sb = (await call('/inventory/status?warehouseId=b', mgr)).data;
  assert.ok(sa.openedAt); assert.ok(sa.openedBy); assert.equal(sa.moveCount, 3);
  assert.equal(sb.openedAt, null); assert.equal(sb.openedBy, ''); assert.equal(sb.moveCount, 0);
  const all = (await call('/inventory/status', mgr)).data;
  assert.equal(all.openedAt, null, 'không lấy ngày chốt của A báo cho cả nhóm khi B chưa chốt');
  assert.deepEqual(all.warehouses.map((w: any) => [w.id, !!w.openedAt, w.moveCount]), [['a', true, 3], ['b', false, 0]]);
  assert.equal((await call('/inventory/status?warehouseId=khong-co', mgr)).status, 403);

  // Tra tồn: nguồn từng kho; nguồn chung 'mixed'.
  const look = (await call('/inventory/lookup?q=S1', emp)).data;
  assert.equal(look.source, 'mixed');
  assert.deepEqual(look.products[0].stock.map((s: any) => [s.warehouseId, s.source, s.qty]), [['a', 'ledger', 5], ['b', 'sapo', 0]]);

  // Đối chiếu: kho chưa chốt không vào bảng / số lệch, báo riêng.
  let cmp = (await call('/inventory/compare?diff=0', mgr)).data;
  assert.deepEqual(cmp.unopened, [{ warehouseId: 'b', name: 'Kho B' }]);
  assert.deepEqual(cmp.rows.map((x: any) => x.warehouseId), ['a', 'a', 'a']); assert.equal(cmp.diffCount, 0);
  cmp = (await call('/inventory/compare?warehouseId=b&diff=0', mgr)).data;
  assert.deepEqual([cmp.rows, cmp.diffCount, cmp.unopened], [[], 0, [{ warehouseId: 'b', name: 'Kho B' }]]);
  await db.insert(productStock).values({ sku: 'S1', warehouseId: 'b', quantity: 50, updatedAt: at });
  assert.equal((await call('/inventory/compare', mgr)).data.diffCount, 0, 'tồn Sapo của kho chưa chốt không tính là lệch');

  // Chốt lại A không đổi gì → 0 dòng.
  const before = (await db.select().from(stockMoves)).length;
  const again = await call('/inventory/opening', mgr, 'POST', { confirm: true, warehouseId: 'a' });
  assert.equal(again.status, 200); assert.equal(again.data.lines, 0); assert.equal(again.data.results[0].status, 'skipped');
  assert.equal((await db.select().from(stockMoves)).length, before);
  // "Tất cả kho" không chốt lại A; B giờ có tồn → chốt được.
  const second = (await call('/inventory/opening', mgr, 'POST', { confirm: true })).data;
  assert.deepEqual(second.results.map((x: any) => [x.warehouseId, x.status, x.lines]), [['a', 'skipped', 0], ['b', 'opened', 1]]);
  assert.equal((await call('/inventory/lookup?q=S1', emp)).data.source, 'ledger');
});

test('B có tồn Sapo âm: chỉ B thất bại (liệt kê mã), A vẫn chốt; chốt lại A sau điều chỉnh bị chặn, không ghi gì, B không đổi', async () => {
  const { db, call, mgr } = await setup('negative');
  const r = (await call('/inventory/opening', mgr, 'POST', { confirm: true })).data;
  assert.deepEqual(r.results.map((x: any) => [x.warehouseId, x.status, x.code ?? '']), [['a', 'opened', ''], ['b', 'failed', 'OPENING_NEGATIVE_STOCK']]);
  assert.match(r.results[1].message, /S1 \(-3\)/); assert.doesNotMatch(r.results[1].message, /S2/);
  assert.equal((await db.select().from(stockBalances).where(eq(stockBalances.warehouseId, 'b'))).length, 0, 'giao dịch của B rollback');
  // Chọn đúng B → 409 như trước.
  const one = await call('/inventory/opening', mgr, 'POST', { confirm: true, warehouseId: 'b' });
  assert.equal(one.status, 409); assert.equal(one.data.code, 'OPENING_NEGATIVE_STOCK');
  // Sửa B rồi chốt B; sau đó điều chỉnh A và thử chốt lại A.
  await db.update(productStock).set({ quantity: 3 }).where(eq(productStock.warehouseId, 'b'));
  assert.equal((await call('/inventory/opening', mgr, 'POST', { confirm: true, warehouseId: 'b' })).data.lines, 2);
  assert.equal((await call('/inventory/adjustments', mgr, 'POST', { clientKey: crypto.randomUUID(), warehouseId: 'a', reason: 'Kiểm kê', lines: [{ sku: 'S1', qty: -1 }] })).status, 201);
  await db.update(productStock).set({ quantity: 100 }).where(eq(productStock.warehouseId, 'b'));
  const moves = await db.select().from(stockMoves), bals = await db.select().from(stockBalances);
  const reopen = await call('/inventory/opening', mgr, 'POST', { confirm: true, warehouseId: 'a' });
  assert.equal(reopen.status, 409); assert.equal(reopen.data.code, 'WAREHOUSE_OPENING_USED');
  const all = (await call('/inventory/opening', mgr, 'POST', { confirm: true })).data;
  assert.deepEqual(all.results.map((x: any) => x.status), ['skipped', 'skipped']);
  assert.deepEqual(await db.select().from(stockMoves), moves, 'không ghi dòng nào');
  assert.deepEqual(await db.select().from(stockBalances), bals, 'B không đổi dù tồn Sapo B đã khác');
});

test('Sổ kho: link phiếu giao COD, phiếu trả, phiếu nhận NCC mở đúng chứng từ; người không có quyền trang đích không nhận link', async () => {
  const p = await setupPos(), shift = await p.open();
  const { db } = p;
  await db.insert(salesOrders).values({ id: 'so-link', orderNo: 'DH-link', quoteType: 'B2B', orderDate: '2026-10-01', customerName: 'Khách', createdBy: 'mgr', ownerId: 'mgr', createdAt: at, updatedAt: at, status: 'confirmed' });
  await db.insert(deliveries).values({ id: 'dl-link', deliveryNo: 'GH-link', orderId: 'so-link', plannedDate: '2026-10-01', createdBy: 'mgr', createdAt: at, updatedAt: at });
  await db.insert(posReturns).values({ id: 'rt-link', returnNo: 'TH-link', orderId: 'so-link', registerId: p.registerId, warehouseId: 'pos-wh', createdShiftId: shift.id, kind: 'return', status: 'completed',
    reason: 'Khách trả', sourceSnapshot: '{}', requestKey: 'rt-link-key', createdBy: 'mgr', createdAt: at, updatedAt: at });
  await db.insert(suppliers).values({ id: 'sup-link', name: 'NCC', nameKey: 'ncc-link', createdAt: at, updatedAt: at, createdBy: 'mgr' });
  await db.insert(incomingShipments).values({ id: 'po-link', ticketNumber: 'PO-link', source: 'supplier-order', warehouse: 'Kho POS', supplierId: 'sup-link', supplierName: 'NCC', approvalStatus: 'approved', supplierStatus: 'confirmed', createdAt: at, updatedAt: at, createdBy: 'mgr' });
  await db.insert(supplierReceipts).values({ id: 'rc-link', receiptNo: 'PNH-link', shipmentId: 'po-link', receivedDate: '2026-10-01', receivedBy: 'mgr', warehouse: 'Kho POS', clientKey: 'rc-link-key', createdAt: at });
  const row = (id: string, refType: 'pos_delivery' | 'pos_return' | 'supplier_receipt', kind: 'issue' | 'customer_return' | 'receipt', qty: number, refId: string) =>
    ({ id, sku: '00123', warehouseId: 'pos-wh', qty, kind, refType, refId, refNo: refId.toUpperCase(), createdBy: 'mgr', createdAt: '2026-10-02T00:00:0' + id.slice(-1) + '.000Z' });
  await db.insert(stockMoves).values([row('m1', 'pos_delivery', 'issue', -1, 'dl-link'), row('m2', 'pos_return', 'customer_return', 1, 'rt-link'), row('m3', 'supplier_receipt', 'receipt', 2, 'rc-link')]);
  const linkOf = (moves: any[]) => Object.fromEntries(moves.filter((m: any) => m.refType !== 'opening').map((m: any) => [m.refType, m.link]));
  assert.deepEqual(linkOf((await p.call('/stock-moves?sku=00123', p.mgr)).data.moves),
    { pos_delivery: '#/orders/so-link', pos_return: '#/orders/so-link', supplier_receipt: '#/purchases/po-link' });

  // Nhân viên chỉ được trang Đóng gói: vẫn xem sổ kho nhưng không nhận link tới Đơn hàng / Đơn mua NCC.
  await db.insert(employees).values({ id: 'kho-link', name: 'Kho', email: 'kho-link@x.vn', role: 'employee', positionId: 'warehouse', createdAt: at });
  await db.insert(credentials).values({ memberId: 'kho-link', passwordHash: await hashPassword(PASSWORD, 1000), version: 0 });
  assert.equal((await p.call('/permissions/positions/warehouse', p.mgr, 'PUT', { perms: ['page.packing'] })).status, 200);
  const kho = (await p.call('/login', '', 'POST', { email: 'kho-link@x.vn', password: PASSWORD })).cookie;
  const seen = await p.call('/stock-moves?sku=00123', kho);
  assert.equal(seen.status, 200, JSON.stringify(seen.data));
  assert.deepEqual(linkOf(seen.data.moves), { pos_delivery: '', pos_return: '', supplier_receipt: '' });
  // Được cấp lại Đơn mua NCC → chỉ link phiếu nhận NCC hiện.
  await p.call('/permissions/positions/warehouse', p.mgr, 'PUT', { perms: ['page.packing', 'page.purchases'] });
  assert.deepEqual(linkOf((await p.call('/stock-moves?sku=00123', kho)).data.moves), { pos_delivery: '', pos_return: '', supplier_receipt: '#/purchases/po-link' });
});
