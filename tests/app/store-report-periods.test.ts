import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
import { inventoryAdjustments, stockBalances, stockTransfers, stockTransferLines } from '../../src/modules/inventory/schema.ts';
import { products, productMovements, warehouses } from '../../src/modules/catalog/schema.ts';
import { hrAttendance } from '../../src/modules/hr/schema.ts';
import { compareMonth, prevMonth, restockNeeds, stocktakeGaps, vnClock, mondayOf } from '../../src/modules/store/domain/reports.ts';

/** Báo cáo tuần / tháng / kiểm tồn của CHT: chỉ tiêu cùng nguồn xét thưởng, hàng cần bổ sung, so tháng trước, nhóm hàng, kiểm tồn. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('domain: bổ sung theo ngưỡng (tồn trống + đang về), so tháng trước thiếu dữ liệu ≠ 0, thừa / thiếu không cộng bù', () => {
  const need = restockNeeds([{ sku: 'A', minQty: 10, onHand: 8, held: 3, incoming: 2 }, { sku: 'B', minQty: 5, onHand: 9, held: 0, incoming: 0 }]);
  assert.deepEqual(need.map(n => [n.sku, n.free, n.suggest]), [['A', 5, 3]]);
  assert.deepEqual(compareMonth(100, null), { diff: null, pct: null, missing: true });
  assert.deepEqual(compareMonth(150, 100), { diff: 50, pct: 50, missing: false });
  const g = stocktakeGaps([{ sku: 'A', qty: 2, value: 200 }, { sku: 'B', qty: -2, value: 200 }, { sku: 'C', qty: -1, value: null }, { sku: 'D', qty: 0, value: 0 }], 150);
  assert.equal(g.surplus.qty, 2); assert.equal(g.shortage.qty, 3, 'thiếu không bị thừa bù'); assert.equal(g.shortage.value, 200);
  assert.deepEqual(g.missingCost, ['C']); assert.deepEqual(g.mustExplain, ['A', 'B']); assert.equal(g.noGap, false);
  assert.deepEqual(stocktakeGaps([{ sku: 'A', qty: 1, value: 999 }], null).mustExplain, [], 'chưa cấu hình ngưỡng: không bắt buộc theo mã');
  assert.equal(stocktakeGaps([{ sku: 'A', qty: 0, value: 0 }], 1).noGap, true);
});

async function store() {
  const f = await setup();
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' }));
  const day = vnClock(new Date().toISOString()).day, month = day.slice(0, 7);
  const shift = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  ok(await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 694_400 }));
  const draft = async (kind: string, period: string, cookie = f.emp) => ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=${kind}&period=${period}`, cookie));
  return { ...f, day, month, shift, draft };
}

test('báo cáo tuần: chỉ tiêu lấy đúng nguồn đã cấu hình, tách doanh thu POS (gồm VAT) với doanh số xét chỉ tiêu; hàng cần bổ sung theo ngưỡng', async () => {
  const f = await store();
  const monday = mondayOf(f.day);
  let d = await f.draft('weekly', monday);
  assert.equal(d.facts.target.configured, false, 'chưa cấu hình nguồn: không gán mặc định 300 triệu');
  assert.match(d.facts.target.reason, /cấu hình/);
  assert.equal(d.facts.restock.configured, false, 'chưa có ngưỡng: báo chưa cấu hình');
  // Cấu hình nguồn doanh số cửa hàng: quầy này là cửa hàng Lock.
  const path = '/hr/team-revenue-sources/' + f.month, version = ok(await f.call(path, f.mgr)).version;
  const [reg] = await f.db.select().from(posShifts).where(eq(posShifts.id, f.shift.id));
  await f.db.insert((await import('../../src/modules/sales/pos-schema.ts')).posRegisters).values({ ...(await f.db.select().from((await import('../../src/modules/sales/pos-schema.ts')).posRegisters))[0]!, id: 'ml-reg', name: 'ML' });
  ok(await f.call(path, f.mgr, 'PUT', { version, bnRegisterId: 'ml-reg', lockRegisterId: reg!.registerId, bonusMode: 'tiers', reason: 'Kiểm thử nguồn' }));
  d = await f.draft('weekly', monday);
  assert.equal(d.facts.target.configured, true); assert.equal(d.facts.target.target, 300_000_000);
  assert.equal(d.facts.revenue, 194_400, 'doanh thu POS của báo cáo gồm VAT');
  assert.equal(d.facts.target.pos, 180_000, 'doanh số xét chỉ tiêu dùng giá trước VAT');
  assert.equal(d.facts.target.rate, 0); assert.ok(Array.isArray(d.facts.target.tiers));
  // Ngưỡng tồn: chỉ Manager đặt; mã lạ bị từ chối.
  assert.equal((await f.call('/store/restock-rules', f.emp, 'PUT', { registerId: f.registerId, rules: [{ sku: '00123', minQty: 50 }] })).status, 403);
  assert.equal((await f.call('/store/restock-rules', f.mgr, 'PUT', { registerId: f.registerId, rules: [{ sku: 'KHONG-CO', minQty: 5 }] })).status, 400);
  assert.equal((await f.call('/store/restock-rules', f.mgr, 'PUT', { registerId: f.registerId, rules: [{ sku: '00123', minQty: 0 }] })).status, 400);
  ok(await f.call('/store/restock-rules', f.mgr, 'PUT', { registerId: f.registerId, rules: [{ sku: '00123', minQty: 50 }] }));
  assert.equal(ok(await f.call(`/store/restock-rules?registerId=${f.registerId}`, f.emp)).rules[0].minQty, 50);
  // Hàng đang về: phiếu điều chuyển tới kho đã duyệt, chưa nhận.
  await f.db.insert(warehouses).values({ id: 'wh-main', name: 'Kho tổng', kind: 'stock' });
  const now = new Date().toISOString();
  await f.db.insert(stockTransfers).values({ id: 'tr1', transferNo: 'DC-1', fromWarehouseId: 'wh-main', toWarehouseId: 'pos-wh', status: 'approved', requestedBy: 'mgr', createdAt: now, updatedAt: now });
  await f.db.insert(stockTransferLines).values({ id: 'tl1', transferId: 'tr1', sku: '00123', qty: 30 });
  d = await f.draft('weekly', monday);
  const item = d.facts.restock.items[0];
  assert.equal(item.sku, '00123'); assert.equal(item.onHand, 8); assert.equal(item.incoming, 30); assert.equal(item.suggest, 50 - 8 - 30);
});

test('báo cáo tháng: so tháng trước thiếu dữ liệu, nhóm theo thương hiệu có "Chưa phân loại", lệch thừa / thiếu riêng, công HR để đối chiếu', async () => {
  const f = await store();
  let d = await f.draft('monthly', f.month);
  assert.equal(d.facts.previous.revenue, null, 'tháng trước không có ca: thiếu dữ liệu, không phải 0');
  assert.equal(d.facts.previous.posCompare.missing, true);
  assert.deepEqual(d.facts.brands.map((b: any) => [b.group, b.unclassified]), [['Chưa phân loại', true]]);
  assert.equal(d.facts.target.configured, false);
  assert.equal(d.facts.staff[0].hrWorked, null, 'chưa chấm công HR');
  // Thêm ca tháng trước, thương hiệu, lệch thừa / thiếu, chấm công.
  await f.db.update(products).set({ brand: 'Minh Long' }).where(eq(products.sku, '00123'));
  const [base] = await f.db.select().from(posShifts).where(eq(posShifts.id, f.shift.id));
  const prevDay = prevMonth(f.month) + '-15';
  await f.db.insert(posShifts).values([{ ...base!, id: 'prev-shift', businessDate: prevDay, openKey: 'prev-key', previousShiftId: null, cashDifference: 0 },
    { ...base!, id: 'over-shift', businessDate: f.day, openKey: 'over-key', previousShiftId: null, cashDifference: 20_000, differenceReason: 'Đếm sai' }]);
  await f.db.update(posShifts).set({ cashDifference: -30_000, differenceReason: 'Thiếu tiền lẻ' }).where(eq(posShifts.id, f.shift.id));
  await f.db.insert(hrAttendance).values([{ memberId: 'emp', workDate: f.day, status: 'present', updatedAt: new Date().toISOString() }]);
  d = await f.draft('monthly', f.month);
  assert.deepEqual(d.facts.brands.map((b: any) => b.group), ['Minh Long']);
  assert.equal(d.facts.cashGaps.shortage, -30_000); assert.equal(d.facts.cashGaps.surplus, 20_000, 'không cộng bù thành -10.000');
  assert.equal(d.facts.previous.revenue, 0, 'tháng trước có ca, không có bán: 0 thật'); assert.equal(d.facts.previous.posCompare.missing, false);
  assert.equal(d.facts.staff.find((s: any) => s.member).hrWorked, 1);
});

test('kiểm tồn: đúng kho + kỳ, phiếu chờ duyệt vẫn nộp được, không lệch, thiếu giá, phạm vi chưa kiểm, giải trình theo mã, giá vốn chỉ Manager xem', async t => {
  const f = await store();
  const prev = prevMonth(f.month), at = new Date(Date.parse(prev + '-20T10:00:00+07:00')).toISOString();
  await f.db.insert(products).values([{ sku: 'B2', name: 'Bát', updatedAt: at }, { sku: 'C3', name: 'Chén', updatedAt: at }]);
  await f.db.insert(stockBalances).values([{ sku: 'B2', warehouseId: 'pos-wh', qty: 4, updatedAt: at }, { sku: 'C3', warehouseId: 'pos-wh', qty: 2, updatedAt: at }]);
  await f.db.insert(productMovements).values({ id: 'pm1', refKey: 'k1', sku: '00123', kind: 'purchase', qty: 10, unitPrice: 60_000, occurredAt: at, recordedAt: at });
  await f.db.insert(warehouses).values({ id: 'other-wh', name: 'Kho khác', kind: 'stock' });
  const adj = (id: string, warehouseId: string, lines: unknown[], status = 'pending', createdAt = at) =>
    ({ id, refNo: 'KK-' + id, clientKey: 'ck-' + id, payloadHash: 'h', warehouseId, reason: 'Kiểm kê', lines: JSON.stringify(lines), status: status as 'pending', createdBy: 'emp', createdAt, ...(status === 'pending' ? {} : { reviewedBy: 'mgr', reviewedAt: createdAt }) });
  await f.db.insert(inventoryAdjustments).values([
    adj('a1', 'pos-wh', [{ sku: '00123', source: 'stocktake', expectedQty: 10, countedQty: 7, qty: -3 }, { sku: 'B2', source: 'stocktake', expectedQty: 4, countedQty: 5, qty: 1 }]),
    adj('a2', 'pos-wh', [{ sku: 'B2', source: 'stocktake', expectedQty: 5, countedQty: 5, qty: 0 }], 'approved'),
    adj('other', 'other-wh', [{ sku: 'C3', source: 'stocktake', expectedQty: 1, countedQty: 0, qty: -1 }]),
    adj('old', 'pos-wh', [{ sku: 'C3', source: 'stocktake', expectedQty: 1, countedQty: 0, qty: -1 }], 'pending', new Date(Date.parse(prev + '-01T00:00:00+07:00') - 1000).toISOString()),
  ]).catch((e: any) => { throw new Error(String(e?.cause?.message ?? e)); });
  ok(await f.call('/store/settings', f.mgr, 'PUT', { registerId: f.registerId, stocktakeExplainThreshold: 100_000 }));
  const mgr = await f.draft('stocktake', prev, f.mgr);
  assert.deepEqual(mgr.facts.counts.map((c: any) => c.refNo), ['KK-a1', 'KK-a2'], 'chỉ phiếu đúng kho và kỳ');
  assert.equal(mgr.facts.counts[1].noGap, true, 'ghi nhận phiếu không lệch');
  assert.equal(mgr.facts.pending, 1);
  assert.equal(mgr.facts.surplus.qty, 0, 'B2 đếm lại ở phiếu sau → lấy kết quả mới nhất'); assert.equal(mgr.facts.shortage.qty, 3);
  assert.equal(mgr.facts.shortage.value, 180_000); assert.match(mgr.facts.valuation, /không phải tiền bồi thường/);
  assert.deepEqual(mgr.facts.scope, { countedSkus: 2, stockedSkus: 3, notCounted: 1, notCountedSample: ['C3'] });
  assert.deepEqual(mgr.facts.lines.filter((l: any) => l.mustExplain).map((l: any) => l.sku), ['00123']);
  const cht = await f.draft('stocktake', prev);
  assert.equal(cht.facts.costHidden, true); assert.equal(cht.facts.lines[0].value, null); assert.equal(cht.facts.shortage.value, null, 'CHT không thấy giá vốn');
  const post = (inputs: Record<string, unknown>) => f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'stocktake', period: prev, clientKey: crypto.randomUUID(), inputs });
  const missing = await post({ counted: true });
  assert.equal(missing.status, 400); assert.match(missing.data.error, /00123/);
  ok(await post({ counted: true, skuExplanations: { '00123': 'Bể 3 cái khi xếp kệ, đã báo' }, scopeNote: 'C3 để kho phụ, kiểm tuần sau' }), 201);
  const rep = await f.draft('stocktake', prev);
  assert.equal(rep.report.data.facts.costHidden, true, 'bản chụp trả về CHT cũng ẩn giá vốn');
  assert.equal((await f.draft('stocktake', prev, f.mgr)).report.data.facts.shortage.value, 180_000);
  // Sản phẩm không có giá: ghi nhận thiếu giá, không tính giá trị.
  await f.db.insert(inventoryAdjustments).values(adj('a3', 'pos-wh', [{ sku: 'C3', source: 'stocktake', expectedQty: 2, countedQty: 1, qty: -1 }]));
  const later = await f.draft('stocktake', prev, f.mgr);
  assert.deepEqual(later.facts.missingCost, ['C3']); assert.equal(later.facts.scope.notCounted, 0);
  assert.ok(t);
});
