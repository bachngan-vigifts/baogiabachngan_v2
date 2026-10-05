/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailable, skipReason, loadLegacy, FakeBucket, DETAIL_KEY, buildShipment, baseScenario, members, actors, rng, picker, EMAIL } from './harness.ts';
import { computeOrderTotals, hidePrices } from '../../src/modules/suppliers/domain/order-totals.ts';
import { orderVisibility } from '../../src/modules/suppliers/domain/visibility.ts';

const L: any = legacyAvailable ? await loadLegacy() : null;
const opts = { skip: skipReason };

/** Dựng bucket nhiều đơn: mỗi đơn có file chi tiết riêng. */
function bucketOf(orders: { shipment: any; rows: any[] }[]): FakeBucket {
  const b = new FakeBucket();
  b.store.set('incoming-stock/index.json', { data: JSON.stringify({ shipments: orders.map(o => o.shipment) }), etag: 'e0' });
  for (const o of orders) b.store.set(o.shipment.key, { data: JSON.stringify({ rows: o.rows }), etag: 'e' + o.shipment.id });
  return b;
}

test('TỔNG TIỀN ĐƠN NCC ↔ bản cũ: từng dòng, VAT, tổng, tiền cọc, đã trả, còn lại – trên 3.000 đơn ngẫu nhiên (số thực giống hệt từng bit)', opts, async () => {
  const r = rng(505), pick = picker(r);
  const qty = [0, 1, 2, 2.5, 3.5, 10, 100, '3', undefined, null, -2, 'abc'], price = [0, 1, 99, 12.5, 100000, 690741, 1234567, undefined, null, '15000', 'abc', -5];
  const fee = [0, 2000, 25000, undefined, null, -3, 'z'], tax = [undefined, null, 0, 5, 8, 10, '8', 'abc', 150];
  const disc = [0, 10, 25, 12.5, 100, 101, -4, undefined, null, 'abc', '15'], rate = [undefined, 0, 20, 30, 50, 100, 150, -5, 'abc', 12.345, '40'], paid = [undefined, 0, 100, 1e6, 'x', -5, null, 5e12];
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(r() * 4), skus = Array.from({ length: n }, (_, k) => `S${k}`);
    const rows = skus.map(sku => ({ sku, name: sku, unit: 'cái', quantity: pick(qty), price: pick(price), printFee: pick(fee), taxRate: pick(tax) }));
    const itemDiscounts = skus.map(sku => ({ sku, purchaseDiscount: pick(disc) }));
    const confirmations = r() < 0.5 ? skus.filter(() => r() < 0.6).map(sku => ({ sku, purchaseDiscount: pick(disc), confirmed: true })) : undefined;
    const extra: any = { itemDiscounts, depositRate: pick(rate), stockRows: skus.map(sku => ({ sku, quantity: 1 })) };
    if (confirmations) extra.supplierConfirmations = confirmations;
    const p1 = pick(paid), p2 = pick(paid); if (p1 !== undefined) extra.depositPaidAmount = p1; if (p2 !== undefined) extra.paidAmount = p2;
    const shipment = buildShipment(baseScenario, extra);
    const b = bucketOf([{ shipment, rows }]);

    const legacyFull = (await L.listApprovedSupplierOrders(b, members.manager)).orders[0];
    const legacyHidden = (await L.listApprovedSupplierOrders(b, members.employee)).orders[0];

    const confByKey = new Map<string, any>((confirmations ?? []).map(c => [c.sku.toLowerCase(), c]));
    const discByKey = new Map(itemDiscounts.map(d => [d.sku.toLowerCase(), Number(d.purchaseDiscount) || 0]));
    const mine = computeOrderTotals({
      depositRate: extra.depositRate,
      paidAmount: extra.depositPaidAmount ?? extra.paidAmount,
      rows: rows.map(row => {
        const c = confByKey.get(row.sku.toLowerCase());
        const cd = c ? Number(c.purchaseDiscount) : NaN;
        return { quantity: row.quantity as number, price: row.price as number, printFee: row.printFee as number, taxRate: row.taxRate as number, purchaseDiscount: discByKey.get(row.sku.toLowerCase()) ?? 0, confirmedPurchaseDiscount: Number.isFinite(cd) ? cd : null };
      }),
    });
    const ctx = `#${i} ${JSON.stringify({ rows, itemDiscounts, confirmations, depositRate: extra.depositRate, paid: [p1, p2] })}`;
    assert.deepStrictEqual([mine.subtotal, mine.vat, mine.total, mine.depositAmount, mine.depositPaidAmount, mine.remainingAmount], [legacyFull.subtotal, legacyFull.vat, legacyFull.total, legacyFull.depositAmount, legacyFull.depositPaidAmount, legacyFull.remainingAmount], ctx);
    assert.deepStrictEqual(mine.rows.map(x => [x.lineTotal, x.lineVat, x.priceAfterDiscount, x.purchaseDiscount, x.quantity]), legacyFull.rows.map((x: any) => [x.lineTotal, x.lineVat, x.priceAfterDiscount, x.purchaseDiscount, x.quantity]), ctx);
    assert.equal(mine.depositRate, legacyFull.depositRate, ctx);

    const hidden = hidePrices(mine);
    assert.equal(legacyHidden.priceHidden, true);
    assert.deepStrictEqual([hidden.subtotal, hidden.vat, hidden.total, hidden.depositAmount, hidden.depositPaidAmount, hidden.remainingAmount], [legacyHidden.subtotal, legacyHidden.vat, legacyHidden.total, legacyHidden.depositAmount, legacyHidden.depositPaidAmount, legacyHidden.remainingAmount], ctx);
    assert.deepStrictEqual(hidden.rows.map(x => [x.unitPrice, x.taxRate, x.lineTotal, x.lineVat, x.priceAfterDiscount, x.quantity]), legacyHidden.rows.map((x: any) => [x.unitPrice, x.taxRate, x.lineTotal, x.lineVat, x.priceAfterDiscount, x.quantity]), ctx);
  }
});

test('AI THẤY ĐƠN NÀO ↔ bản cũ: danh sách của Manager / nhân viên / từng NCC giống hệt (NCC khác không thấy đơn của nhau)', opts, async () => {
  const r = rng(606), pick = picker(r);
  let seenHidden = 0, seenFull = 0;
  for (let round = 0; round < 300; round++) {
    const count = 3 + Math.floor(r() * 6), orders = Array.from({ length: count }, (_, k) => {
      const sc = { ...baseScenario, source: pick(['supplier-order', 'supplier-order', 'incoming-stock', 'supplier-delivery-note']), approvalStatus: pick(['approved', 'approved', 'pending']), supplierKey: pick(['S1', 'S2'] as const), received: r() < 0.2 };
      const id = `0000000${k}-0000-0000-0000-000000000000`;
      return { sc, shipment: buildShipment(sc, { id, key: `incoming-stock/d${k}.json` }), rows: [{ sku: 'A1', name: 'N', quantity: 1, price: 1000, taxRate: 8, printFee: 0 }] };
    });
    const b = bucketOf(orders);
    for (const who of Object.keys(members) as (keyof typeof members)[]) {
      const legacyOrders: any[] = (await L.listApprovedSupplierOrders(b, members[who])).orders;
      const legacyIds = legacyOrders.map(o => o.id).sort();
      const level = (o: (typeof orders)[number]) => orderVisibility(actors[who], { source: o.sc.source, approvalStatus: o.sc.approvalStatus, supplierId: o.sc.supplierKey });
      const mineIds = orders.filter(o => level(o) !== 'none').map(o => o.shipment.id).sort();
      assert.deepEqual(mineIds, legacyIds, `vòng ${round} – ${who}`);
      // mức hiển thị phải khớp: bản cũ đánh dấu priceHidden đúng với đơn mà bản mới trả 'prices-hidden'
      for (const lo of legacyOrders) {
        const mine = level(orders.find(o => o.shipment.id === lo.id)!);
        assert.equal(Boolean(lo.priceHidden), mine === 'prices-hidden', `vòng ${round} – ${who} – ${lo.id}: mức hiển thị`);
      }
      seenHidden += legacyOrders.filter(o => o.priceHidden).length; seenFull += legacyOrders.filter(o => !o.priceHidden).length;
    }
  }
  assert.ok(seenHidden > 100 && seenFull > 100, `thiếu ca ẩn giá/đủ giá: ${seenHidden}/${seenFull}`);
});

test('GHI CHÚ KHÁC BIỆT: hai email nội bộ viết cứng trong bản cũ nay là dữ liệu (tài khoản gắn với NCC "Minh Long")', opts, async () => {
  // Bản cũ: hai email này thấy MỌI đơn có tên NCC chứa "minh long", bất kể email NCC ghi trên đơn.
  const sc = { ...baseScenario, supplierKey: 'S1' as const };
  const shipment = buildShipment(sc, { supplierName: 'Minh Long I', supplierEmail: 'khac@ncc.vn' });
  const b = bucketOf([{ shipment, rows: [] }]);
  for (const email of ['bachngankg@gmail.com', 'sales.bachngankg@gmail.com']) {
    const legacy = (await L.listApprovedSupplierOrders(b, { id: 'x', role: 'supplier', email, name: 'x' })).orders;
    assert.equal(legacy.length, 1, `${email} thấy đơn Minh Long trong bản cũ`);
  }
  assert.equal(EMAIL.S1, 's1@x.vn');
  // Bản mới không có ngoại lệ trong code: muốn hai tài khoản đó thấy đơn Minh Long thì gắn họ vào nhà cung cấp "Minh Long" ở trang quản lý NCC.
  const unlinked = { ...actors.supplier1, supplierId: null };
  assert.equal(orderVisibility(unlinked, { source: 'supplier-order', approvalStatus: 'approved', supplierId: 'S1' }), 'none');
  assert.equal(orderVisibility({ ...unlinked, supplierId: 'S1' }, { source: 'supplier-order', approvalStatus: 'approved', supplierId: 'S1' }), 'full');
});
