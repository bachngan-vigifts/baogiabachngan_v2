import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupLiquidation } from '../helpers/liquidation-fixture.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { productMovements } from '../../src/modules/catalog/schema.ts';
import { bucketOf, orderProfit, purchaseCostAt } from '../../src/modules/profit/domain/profit.ts';

/** Phân tích lợi nhuận: chỉ Manager; giá vốn từ báo giá → giá nhập gần nhất; thiếu giá vốn không tính 0; gộp theo kỳ / nhân viên / khách / sản phẩm. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const stamp = '2026-11-10T03:00:00Z';
const order = (id: string, extra: Record<string, unknown> = {}) => ({ id, orderNo: 'DH-' + id, quoteType: 'HRC' as const, customerName: 'Khách ' + id, ownerId: 'emp', createdBy: 'emp',
  orderDate: '2026-11-10', status: 'confirmed', total: 0, subtotal: 0, createdAt: stamp, updatedAt: stamp, ...extra }) as typeof salesOrders.$inferInsert;
const line = (id: string, orderId: string, sku: string, name: string, qty: number, unitPrice: number, lineNo = 1) =>
  ({ id, orderId, lineNo, sku, name, qty, unitPrice, amount: qty * unitPrice });

async function setup() {
  const f = await setupLiquidation();
  const rows = [{ sku: 'A', name: 'Ly sứ', qty: 10, price: 100000, discount: 0, costPrice: 60000, commission: { mode: 'amount', value: 5000 } }];
  await f.db.insert(quotations).values({ id: 'q1', creatorId: 'emp', quoteNo: 'BG-1', quoteType: 'HRC', customer: 'Khách q', data: JSON.stringify({ type: 'HRC', rows }), createdAt: stamp, updatedAt: stamp });
  await f.db.insert(salesOrders).values([
    order('quote', { quoteId: 'q1', customerName: 'Agribank Bến Tre' }),
    order('pos', { channel: 'crm', orderDate: '2026-11-20', ownerId: 'mgr', createdBy: 'mgr' }),
    order('miss', { orderDate: '2026-12-02' }),
    order('cancel', { status: 'cancelled' }),
    order('draft', { status: 'draft' }),
  ]);
  await f.db.insert(salesOrderLines).values([
    line('l1', 'quote', 'A', 'Ly sứ', 10, 100000),
    line('l2', 'pos', 'B', 'Bình giữ nhiệt', 2, 150000),
    line('l3', 'miss', 'C', 'Hộp quà', 1, 500000), line('l4', 'miss', 'B', 'Bình giữ nhiệt', 1, 150000, 2),
    line('l5', 'cancel', 'B', 'Bình giữ nhiệt', 9, 150000), line('l6', 'draft', 'B', 'Bình giữ nhiệt', 9, 150000),
  ]);
  const buy = (id: string, at: string, price: number) => ({ id, refKey: 'buy-' + id, sku: 'B', kind: 'purchase' as const, qty: 10, unitPrice: price, occurredAt: at, recordedAt: at });
  await f.db.insert(productMovements).values([buy('1', '2026-10-01T02:00:00Z', 100000), buy('2', '2026-12-01T02:00:00Z', 120000)]);
  return f;
}

test('domain: kỳ ngày / tuần / tháng / năm; giá nhập gần nhất trước ngày bán, không có thì sau; thiếu giá vốn không tính 0', () => {
  assert.deepEqual(['day', 'week', 'month', 'year'].map(g => bucketOf('2026-11-12', g as never)), ['2026-11-12', '2026-11-09', '2026-11', '2026']);
  const h = [{ at: '2026-10-01T00:00:00Z', price: 100 }, { at: '2026-12-01T00:00:00Z', price: 120 }];
  assert.deepEqual(purchaseCostAt(h, '2026-11-10'), { cost: 100, source: 'purchase' });
  assert.deepEqual(purchaseCostAt(h, '2026-09-10'), { cost: 100, source: 'purchase_later' });
  assert.equal(purchaseCostAt([], '2026-11-10'), null);
  const o = orderProfit({ id: 'o', orderNo: 'o', orderDate: '2026-11-10', ownerId: 'e', customerId: null, customerName: 'K', branchId: 'crm', shippingCost: 30000 },
    [{ id: 'a', sku: 'A', name: 'A', qty: 2, revenue: 200000, quoteCost: 50000, commission: 10000, returnedQty: 1, returnedRevenue: 100000 },
     { id: 'b', sku: 'X', name: 'X', qty: 1, revenue: 90000 }], () => null);
  assert.equal(o.revenue, 190000); assert.equal(o.coveredRevenue, 100000);
  assert.equal(o.cost, 50000, 'trả 1 / 2 → giá vốn còn 1'); assert.equal(o.commission, 5000);
  assert.equal(o.shipping, 0, 'còn dòng thiếu giá vốn → chưa trừ ship'); assert.equal(o.gross, 45000); assert.equal(o.missingLines, 1);
});

test('chỉ Manager; LN gộp theo báo giá / giá nhập; đơn huỷ, nháp không tính; thiếu giá vốn báo riêng; gộp theo kỳ, nhân viên, khách, sản phẩm', async () => {
  const f = await setup();
  assert.equal((await f.call('/profit?from=2026-11-01&to=2026-12-31', f.emp)).status, 403);
  assert.equal((await f.call('/profit/orders/quote', f.emp)).status, 403);
  assert.equal((await f.call('/profit?from=2026-12-31&to=2026-11-01', f.mgr)).status, 400);
  assert.equal((await f.call('/profit?from=2026-11-01&to=2026-12-31&grain=hour', f.mgr)).status, 400);
  const d = ok(await f.call('/profit?from=2026-11-01&to=2026-12-31&grain=month', f.mgr));
  // quote: 1.000.000 − 600.000 − hoa hồng 50.000 = 350.000 · pos: 300.000 − 2 × 100.000 = 100.000 · miss: chỉ dòng B 150.000 − 120.000 (giá nhập 01/12) = 30.000
  assert.equal(d.summary.orders, 3, 'bỏ đơn huỷ và đơn nháp chưa ký HĐKT');
  assert.equal(d.summary.revenue, 1_000_000 + 300_000 + 650_000);
  assert.equal(d.summary.coveredRevenue, 1_000_000 + 300_000 + 150_000);
  assert.equal(d.summary.cost, 600_000 + 200_000 + 120_000);
  assert.equal(d.direct.commission, 50_000);
  assert.equal(d.summary.gross, 350_000 + 100_000 + 30_000);
  assert.equal(d.summary.missingOrders, 1); assert.equal(d.summary.missingRevenue, 500_000, 'dòng Hộp quà thiếu giá vốn – không tính 0');
  assert.deepEqual(d.series.map((r: any) => [r.key, r.gross]), [['2026-11', 450_000], ['2026-12', 30_000]]);
  assert.deepEqual(d.owners.map((r: any) => [r.label, r.gross]), [['Tên emp', 380_000], ['Tên mgr', 100_000]]);
  assert.equal(d.branches[0].label, 'Văn phòng / CRM');
  assert.equal(d.customers.find((r: any) => r.label === 'Agribank Bến Tre').gross, 350_000);
  const b = d.products.find((r: any) => r.key === 'B'); assert.equal(b.qty, 3); assert.equal(b.gross, 130_000);
  assert.equal(d.products.find((r: any) => r.key === 'C').missingRevenue, 500_000);
  assert.ok(Math.abs(d.summary.margin - 480_000 / 1_450_000) < 1e-9, 'biên trên doanh thu đủ giá vốn');
  const owner = ok(await f.call('/profit?from=2026-11-01&to=2026-12-31&owner=mgr', f.mgr));
  assert.equal(owner.summary.orders, 1); assert.equal(owner.filterOptions.owners.length, 2, 'bộ lọc vẫn liệt kê mọi nhân viên');
  const week = ok(await f.call('/profit?from=2026-11-01&to=2026-12-31&grain=week', f.mgr));
  assert.deepEqual(week.series.map((r: any) => r.key), ['2026-11-09', '2026-11-16', '2026-11-30']);
  const detail = ok(await f.call('/profit/orders/miss', f.mgr));
  assert.deepEqual(detail.lines.map((l: any) => [l.sku, l.costSource, l.unitCost]), [['C', 'missing', null], ['B', 'purchase', 120_000]]);
  const q = ok(await f.call('/profit/orders/quote', f.mgr));
  assert.equal(q.lines[0].costSource, 'quote'); assert.equal(q.lines[0].commission, 50_000);
  assert.equal((await f.call('/profit/orders/cancel', f.mgr)).status, 404);
});
