import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupLiquidation } from '../helpers/liquidation-fixture.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { salesLineCosts } from '../../src/modules/sales/line-cost-schema.ts';
import { pricePolicies, productMovements, productPrices, products } from '../../src/modules/catalog/schema.ts';
import { incomingShipmentLines, incomingShipments, suppliers } from '../../src/modules/suppliers/schema.ts';
import { pickLineCost } from '../../src/modules/sales/domain/line-cost.ts';
import { ensureLineCosts } from '../../src/modules/sales/api/line-costs.ts';

/** Giá vốn bổ sung (đơn NCC đã duyệt, công thức thương hiệu): dùng chung lúc bán, khi tính lại đơn cũ và script khôi phục. */
test('domain: báo giá → nhập kho trước → đơn NCC trước → nhập kho sau → đơn NCC sau (backfill) → công thức thương hiệu; khác đơn vị không ghép', () => {
  const day = '2026-11-10', before = '2026-11-01T02:00:00Z', after = '2026-11-20T02:00:00Z';
  const order = (at: string, cost: number, unit = 'Cái') => ({ at, cost, unit, ref: 'po:' + at });
  const fb = (orders: ReturnType<typeof order>[], catalog = true) => ({ orders, catalog: catalog ? { at: before, cost: 45, unit: 'Cái', ref: 'cat', note: '' } : null });
  const pick = (history: { at: string; price: number }[], f: ReturnType<typeof fb> | null, unit = 'Cái') => {
    const c = pickLineCost(null, null, history, day, 'X', f, unit); return c && [c.source, c.unitCost, c.confidence];
  };
  assert.deepEqual(pickLineCost({ name: 'X', qty: 1, costPrice: 70, costMode: 'manual' } as never, null, [{ at: before, price: 60 }], day, 'X', fb([order(before, 50)]), 'Cái')?.source, 'quote');
  assert.deepEqual(pick([{ at: before, price: 60 }], fb([order(before, 50)])), ['purchase', 60, 'estimate']);
  assert.deepEqual(pick([{ at: after, price: 60 }], fb([order(before, 50)])), ['purchase_order', 50, 'estimate'], 'đơn NCC trước ngày bán ưu tiên hơn giá nhập sau ngày bán');
  assert.deepEqual(pick([{ at: after, price: 60 }], fb([order(after, 50)])), ['purchase_later', 60, 'backfill']);
  assert.deepEqual(pick([], fb([order(after, 50)])), ['purchase_order', 50, 'backfill']);
  assert.deepEqual(pick([], fb([])), ['catalog_rule', 45, 'estimate']);
  assert.deepEqual(pick([], fb([order(before, 50, 'Thùng')])), ['catalog_rule', 45, 'estimate'], 'giá theo thùng không ghép vào dòng bán theo cái');
  assert.equal(pick([], fb([], false)), null, 'không có nguồn nào: thiếu giá vốn, không coi là 0');
  assert.equal(pick([], null), null);
});

test('lúc bán và khi tính lại đơn cũ: dùng đơn NCC đã duyệt (bỏ đơn huỷ / chờ duyệt) và công thức thương hiệu; mã không có nguồn vẫn thiếu', async () => {
  const f = await setupLiquidation(), now = '2026-11-01T02:00:00Z';
  await f.db.insert(products).values([
    { sku: 'PO1', name: 'Hộp quà gỗ', unit: 'Cái', brand: 'Vigifts', updatedAt: now },
    { sku: 'LL1', name: 'Hộp nhựa Lock', unit: 'Cái', brand: 'Lock&Lock', updatedAt: now },
    { sku: 'NO1', name: 'Bình Thermos', unit: 'Cái', brand: 'Thermos', updatedAt: now },
  ] as never);
  await f.db.insert(pricePolicies).values([{ id: 'retail', name: 'Giá bán lẻ' }, { id: 'whole', name: 'Giá sỉ' }]);
  await f.db.insert(productPrices).values([{ sku: 'LL1', policyId: 'retail', price: 108000 }, { sku: 'LL1', policyId: 'whole', price: 50000 }, { sku: 'NO1', policyId: 'whole', price: 90000 }]);
  await f.db.insert(suppliers).values({ id: 's1', name: 'NCC Một', nameKey: 's1', createdAt: now, createdBy: 'mgr', updatedAt: now } as never);
  const po = (id: string, extra: Record<string, unknown>, line: Record<string, unknown>) => [
    { id, ticketNumber: 'DMH-' + id, source: 'supplier-order', warehouse: 'Kho', supplierId: 's1', supplierName: 'NCC', approvalStatus: 'approved', approvedAt: now, createdAt: now, createdBy: 'mgr', updatedAt: now, ...extra },
    { id: 'l-' + id, shipmentId: id, lineNo: 1, sku: 'PO1', name: 'Hộp quà gỗ', unit: 'Cái', quantity: 10, price: 100000, purchaseDiscount: 20, printFee: 5000, ...line },
  ] as const;
  for (const [s, l] of [po('ok', {}, {}), po('cancel', { cancelledAt: now }, { price: 1 }), po('pending', { approvalStatus: 'pending' }, { price: 2 }), po('box', {}, { unit: 'Thùng', price: 3 })]) {
    await f.db.insert(incomingShipments).values(s as never); await f.db.insert(incomingShipmentLines).values(l as never);
  }
  // Mã có giá nhập kho thì vẫn ưu tiên giá nhập kho (không đổi nguyên tắc cũ).
  await f.db.insert(products).values({ sku: 'RC1', name: 'Ly sứ', unit: 'Cái', brand: 'Minh Long', updatedAt: now } as never);
  await f.db.insert(productMovements).values({ id: 'rc', refKey: 'buy-rc', sku: 'RC1', kind: 'purchase', qty: 5, unitPrice: 30000, occurredAt: now, recordedAt: now } as never);
  const stamp = '2026-11-10T03:00:00Z';
  await f.db.insert(salesOrders).values([{ id: 'old', orderNo: 'DH-OLD', quoteType: 'HRC', customerName: 'Khách cũ', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-10', status: 'confirmed', total: 0, subtotal: 0, createdAt: stamp, updatedAt: stamp },
    { id: 'new', orderNo: 'DH-NEW', quoteType: 'HRC', customerName: 'Khách mới', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-10', status: 'confirmed', total: 0, subtotal: 0, createdAt: stamp, updatedAt: stamp }] as never);
  const lines = (orderId: string) => ['PO1', 'LL1', 'NO1', 'RC1'].map((sku, i) => ({ id: `${orderId}-${sku}`, orderId, lineNo: i + 1, sku, name: sku, unit: 'Cái', qty: 2, unitPrice: 200000, amount: 400000 }));
  await f.db.insert(salesOrderLines).values([...lines('old'), ...lines('new')] as never);

  // Lúc bán (snapshot): đơn "new".
  await ensureLineCosts(f.db as never, 'new', 'confirm', 'mgr');
  const snaps = new Map((await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId, 'new'))).map(s => [s.sku, [s.source, s.unitCost, s.confidence]]));
  assert.deepEqual(snaps.get('PO1'), ['purchase_order', 85000, 'estimate'], '100.000 × (1 − 20%) + phí in 5.000; bỏ đơn huỷ / chờ duyệt / khác đơn vị');
  assert.deepEqual(snaps.get('LL1'), ['catalog_rule', 45360, 'estimate'], 'giá bán lẻ 108.000 × (1 − 58%), không dùng giá sỉ');
  assert.deepEqual(snaps.get('RC1'), ['purchase', 30000, 'estimate']);
  assert.equal(snaps.has('NO1'), false, 'không có nguồn: không ghi snapshot');

  // Đơn cũ chưa có snapshot: trang lợi nhuận tính lại theo cùng nguyên tắc (gắn nhãn backfill, không ghi CSDL).
  const detail = await f.call('/profit/orders/old', f.mgr);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.deepEqual(detail.data.lines.map((l: any) => [l.sku, l.costSource, l.unitCost]), [['PO1', 'purchase_order', 85000], ['LL1', 'catalog_rule', 45360], ['NO1', 'missing', null], ['RC1', 'purchase', 30000]]);
  assert.equal((await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId, 'old'))).length, 0, 'xem báo cáo không ghi giá vốn');

  // Mã vẫn thiếu sau khi áp đủ nguyên tắc: Manager nhập giá theo mã, áp cho mọi dòng thiếu trong kỳ.
  const q = 'from=2026-11-01&to=2026-11-30';
  assert.equal((await f.call('/profit/missing-costs?' + q, f.emp)).status, 403);
  const missing = await f.call('/profit/missing-costs?' + q, f.mgr);
  assert.equal(missing.status, 200, JSON.stringify(missing.data));
  assert.deepEqual(missing.data.items.map((i: any) => [i.sku, i.unit, i.lines.length, i.qty]), [['NO1', 'Cái', 2, 4]], 'chỉ còn mã không có nguồn nào, gom đơn cũ + đơn mới');
  const post = (body: Record<string, unknown>) => f.call('/profit/missing-costs', f.mgr, 'POST', { from: '2026-11-01', to: '2026-11-30', ...body });
  assert.equal((await post({ reason: '', items: [{ sku: 'NO1', unit: 'Cái', unitCost: 60000 }] })).status, 400, 'bắt buộc lý do');
  assert.equal((await post({ reason: 'Hoá đơn NCC', items: [{ sku: 'NO1', unit: 'Cái', unitCost: -1 }] })).status, 400);
  assert.equal((await f.call('/profit/missing-costs', f.emp, 'POST', { from: '2026-11-01', to: '2026-11-30', reason: 'x y z', items: [{ sku: 'NO1', unit: 'Cái', unitCost: 1 }] })).status, 403);
  const saved = await post({ reason: 'Theo hoá đơn mua NCC tháng 10', items: [{ sku: 'NO1', unit: 'Cái', unitCost: 60000 }, { sku: 'PO1', unit: 'Cái', unitCost: 1 }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.written, 2, 'chỉ ghi dòng đang thiếu; mã đã có nguồn (PO1) không bị ghi đè');
  const rows = await f.db.select().from(salesLineCosts).where(eq(salesLineCosts.sku, 'NO1'));
  assert.deepEqual(rows.map(r => [r.orderId, r.source, r.confidence, r.unitCost]).sort(), [['new', 'manual', 'confirmed', 60000], ['old', 'manual', 'confirmed', 60000]]);
  assert.equal((await f.call('/profit/missing-costs?' + q, f.mgr)).data.items.length, 0);
  assert.equal((await post({ reason: 'Lặp lại', items: [{ sku: 'NO1', unit: 'Cái', unitCost: 99 }] })).data.written, 0, 'gửi lặp không ghi đè giá vừa nhập');
});
