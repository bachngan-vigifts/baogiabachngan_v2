import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { productMovements } from '../../src/modules/catalog/schema.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { salesLineCostHistory, salesLineCosts } from '../../src/modules/sales/line-cost-schema.ts';
import { ensureLineCosts } from '../../src/modules/sales/api/line-costs.ts';
import { pickLineCost, purchaseCostAt, quoteLineCost } from '../../src/modules/sales/domain/line-cost.ts';

/** Giá vốn lưu lúc bán (snapshot): nguồn + thời điểm + mức tin cậy; khoá sau duyệt; Manager điều chỉnh có lý do; đơn cũ = backfill. */
const origin = 'https://cost.test';
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const buy = (id: string, sku: string, at: string, price: number) => ({ id, refKey: 'buy-' + id, sku, kind: 'purchase' as const, qty: 10, unitPrice: price, occurredAt: at, recordedAt: at });

async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const mgr = await login('mgr@x.vn'), emp = await login('emp@x.vn');
  await db.insert(productMovements).values([buy('b1', 'BINH', '2026-10-01T02:00:00Z', 100000)]);
  // Báo giá Manager: dòng 1 nhập tay giá vốn 60.000 (chính xác); dòng 2 không có giá vốn → lấy giá nhập gần nhất (ước tính).
  const q = ok(await call('/quotes', mgr, 'POST', { type: 'HRC', quoteNo: 'BG-COST', customer: 'Khách giá vốn', vat: 8, rows: [
    { name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 100000, costMode: 'manual', costPrice: 60000 },
    { name: 'Bình giữ nhiệt', sku: 'BINH', unit: 'cái', qty: 2, price: 150000 },
  ] }), 201);
  ok(await call(`/quotes/${q.id}/approve`, mgr, 'POST', { revision: 1 }));
  const order = ok(await call('/orders', mgr, 'POST', { quoteId: q.id }), 201);
  // Đơn tạo từ báo giá là nháp chờ duyệt; duyệt = chốt giá vốn.
  ok(await call(`/orders/${order.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true }));
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(salesOrderLines.lineNo);
  return { db, call, mgr, emp, orderId: order.id as string, lines };
}

test('domain: báo giá nhập tay = chính xác, theo CK = ước tính; giá nhập trước ngày bán = ước tính, sau ngày bán = backfill', () => {
  assert.deepEqual(quoteLineCost({ name: 'A', qty: 1, price: 1, costMode: 'manual', costPrice: 5 } as never, 't'), { unitCost: 5, source: 'quote', confidence: 'confirmed', costAt: 't' });
  assert.equal(quoteLineCost({ name: 'A', qty: 1, price: 1, costMode: 'discount', costPrice: 5 } as never, null)!.confidence, 'estimate');
  assert.equal(quoteLineCost({ name: 'A', qty: 1, price: 1 } as never, null), null);
  const h = [{ at: '2026-10-01T00:00:00Z', price: 100 }, { at: '2026-12-01T00:00:00Z', price: 120 }];
  assert.deepEqual(purchaseCostAt(h, '2026-11-10'), { unitCost: 100, source: 'purchase', confidence: 'estimate', costAt: '2026-10-01T00:00:00Z' });
  assert.equal(purchaseCostAt(h, '2026-09-10')!.confidence, 'backfill');
  assert.equal(pickLineCost(null, null, [], '2026-11-10', 'X'), null, 'không có nguồn: thiếu giá vốn, không tính 0');
});

test('tạo đơn từ báo giá ghi snapshot (nguồn, thời điểm, mức tin cậy) + lịch sử; sau duyệt giá nhập mới không đổi snapshot', async () => {
  const f = await setup();
  const snaps = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId, f.orderId));
  const ly = snaps.find(s => s.sku === 'LY1')!, binh = snaps.find(s => s.sku === 'BINH')!;
  assert.deepEqual([ly.unitCost, ly.source, ly.confidence], [60000, 'quote', 'confirmed']);
  assert.deepEqual([binh.unitCost, binh.source, binh.confidence, binh.costAt], [100000, 'purchase', 'estimate', '2026-10-01T02:00:00Z']);
  assert.equal(ly.capturedBy, 'mgr');
  assert.equal((await f.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId, f.orderId))).length, 2);
  // Đơn đã duyệt: nhập hàng giá mới không đổi giá vốn đã chốt; gọi lại (retry) không ghi thêm.
  await f.db.insert(productMovements).values(buy('b2', 'BINH', new Date(Date.now() - 1000).toISOString(), 130000));
  assert.deepEqual(await ensureLineCosts(f.db, f.orderId, 'confirm', null), { written: 0 });
  const [again] = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderLineId, binh.orderLineId));
  assert.equal(again!.unitCost, 100000);
  // Báo cáo lợi nhuận dùng snapshot.
  const detail = ok(await f.call(`/profit/orders/${f.orderId}`, f.mgr));
  assert.deepEqual(detail.lines.map((l: any) => [l.sku, l.unitCost, l.confidence]), [['LY1', 60000, 'confirmed'], ['BINH', 100000, 'estimate']]);
  assert.equal(detail.lines[1].history.length, 1); assert.equal(detail.lines[1].history[0].reason, 'create');
});

test('Manager điều chỉnh giá vốn: bắt buộc lý do, kiểm phiên bản, ghi lịch sử, mức tin cậy chính xác; nhân viên 403', async () => {
  const f = await setup(), binh = f.lines.find(l => l.sku === 'BINH')!;
  const path = `/profit/line-costs/${binh.id}`;
  assert.equal((await f.call(path, f.emp, 'PUT', { unitCost: 90000, reason: 'Giá NCC giảm', revision: 1 })).status, 403);
  assert.equal((await f.call(path, f.mgr, 'PUT', { unitCost: 90000, reason: '', revision: 1 })).status, 400);
  assert.equal((await f.call(path, f.mgr, 'PUT', { unitCost: 90000, reason: 'Giá NCC giảm', revision: 7 })).status, 409, 'phiên bản cũ');
  ok(await f.call(path, f.mgr, 'PUT', { unitCost: 90000, reason: 'Giá NCC giảm theo HĐ 12', revision: 1 }));
  const [s] = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderLineId, binh.id));
  assert.deepEqual([s!.unitCost, s!.source, s!.confidence, s!.revision, s!.note], [90000, 'manual', 'confirmed', 2, 'Giá NCC giảm theo HĐ 12']);
  const hist = await f.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderLineId, binh.id));
  const adj = hist.find(h => h.reason === 'adjust')!;
  assert.deepEqual([adj.previousUnitCost, adj.unitCost, adj.actorId], [100000, 90000, 'mgr']);
  assert.equal(ok(await f.call(`/profit/orders/${f.orderId}`, f.mgr)).lines[1].unitCost, 90000);
});

test('đơn nháp cập nhật snapshot theo giá nhập mới; đổi mã ghi lại; đơn cũ không snapshot = backfill, lọc "chỉ chính xác" loại ra', async (t) => {
  // Keep receipt timestamps before the Vietnamese sale-day cutoff, regardless of the CI runner's wall clock.
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-07T09:00:00Z')});
  const f = await setup(), stamp = new Date().toISOString(), today = stamp.slice(0, 10);
  await f.db.insert(salesOrders).values({ id: 'draft1', orderNo: 'DH-D1', quoteType: 'HRC', customerName: 'Khách nháp', ownerId: 'emp', createdBy: 'emp', orderDate: today,
    status: 'draft', total: 300000, subtotal: 300000, createdAt: stamp, updatedAt: stamp } as typeof salesOrders.$inferInsert);
  await f.db.insert(salesOrderLines).values({ id: 'dl1', orderId: 'draft1', lineNo: 1, sku: 'BINH', name: 'Bình giữ nhiệt', qty: 2, unitPrice: 150000, amount: 300000 });
  await ensureLineCosts(f.db, 'draft1', 'create', 'emp');
  await f.db.insert(productMovements).values(buy('b3', 'BINH', new Date(Date.now() - 60_000).toISOString(), 110000));
  assert.deepEqual(await ensureLineCosts(f.db, 'draft1', 'amend', 'emp'), { written: 1 }, 'đơn nháp cập nhật');
  let [s] = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderLineId, 'dl1'));
  assert.equal(s!.unitCost, 110000);
  // Đổi mã sang hàng chưa có giá nhập: gỡ giá cũ, ghi lịch sử.
  await f.db.update(salesOrders).set({ status: 'confirmed' }).where(eq(salesOrders.id, 'draft1'));
  await f.db.update(salesOrderLines).set({ sku: 'MOI' }).where(eq(salesOrderLines.id, 'dl1'));
  await ensureLineCosts(f.db, 'draft1', 'amend', 'mgr');
  [s] = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderLineId, 'dl1'));
  assert.equal(s, undefined);
  const hist = await f.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderLineId, 'dl1'));
  assert.ok(hist.some(h => h.unitCost === null && /BINH → MOI/.test(h.note)));
  // Đơn cũ (không snapshot) – tính lại và gắn backfill.
  await f.db.insert(salesOrders).values({ id: 'old1', orderNo: 'DH-OLD', quoteType: 'HRC', customerName: 'Khách cũ', ownerId: 'emp', createdBy: 'emp', orderDate: today,
    status: 'confirmed', total: 150000, subtotal: 150000, createdAt: stamp, updatedAt: stamp } as typeof salesOrders.$inferInsert);
  await f.db.insert(salesOrderLines).values({ id: 'ol1', orderId: 'old1', lineNo: 1, sku: 'BINH', name: 'Bình giữ nhiệt', qty: 1, unitPrice: 150000, amount: 150000 });
  const all = ok(await f.call(`/profit?from=2026-11-01&to=${today}`, f.mgr));
  assert.equal(all.summary.revenueBy.backfill, 150000, 'đơn cũ: backfill');
  assert.equal(ok(await f.call('/profit/orders/old1', f.mgr)).lines[0].unitCost, 110000, 'backfill tính lại từ giá nhập gần nhất');
  assert.equal(all.summary.revenueBy.confirmed, 1_000_000); assert.equal(all.summary.revenueBy.estimate, 300000);
  assert.equal(all.summary.revenueBy.missing, 300000, 'dòng đổi mã chưa có giá vốn');
  assert.equal(all.summary.revenueBy.confirmed + all.summary.revenueBy.estimate + all.summary.revenueBy.backfill + all.summary.revenueBy.missing, all.summary.revenue, 'đối soát doanh thu');
  const exact = ok(await f.call(`/profit?from=2026-11-01&to=${today}&costs=confirmed`, f.mgr));
  assert.equal(exact.summary.coveredRevenue, 1_000_000, 'chỉ dòng giá vốn chính xác');
});

test('bán POS ghi giá vốn lúc bán (giá nhập gần nhất, ước tính) trong cùng giao dịch', async () => {
  const { setup: posSetup } = await import('../helpers/pos-fixture.ts');
  const f = await posSetup();
  await f.db.insert(productMovements).values(buy('pos1', '00123', '2026-01-01T02:00:00Z', 45000));
  const shift = await f.open();
  const sale = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  const orderId = sale.order?.id ?? sale.id;
  const snaps = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId, orderId));
  assert.deepEqual(snaps.map(s => [s.sku, s.unitCost, s.source, s.confidence]), [['00123', 45000, 'purchase', 'estimate']]);
  assert.equal((await f.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId, orderId)))[0]!.reason, 'pos');
});
