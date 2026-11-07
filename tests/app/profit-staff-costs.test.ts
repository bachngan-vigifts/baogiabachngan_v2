import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupLiquidation } from '../helpers/liquidation-fixture.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { productMovements } from '../../src/modules/catalog/schema.ts';
import { allocate, fullMonths, isMonthEnd } from '../../src/modules/profit/domain/allocation.ts';

/** Chi phí nhân sự bán hàng (bảng lương) phân bổ vào đơn: giữ nguyên tổng, phần chưa phân bổ, đối soát khớp bảng lương. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('domain: phân bổ giữ nguyên tổng, làm tròn dồn phần lẻ; không có trọng số → null; tháng trọn trong kỳ', () => {
  const a = allocate(100, [1, 1, 1])!; assert.equal(a.reduce((n, x) => n + x, 0), 100); assert.deepEqual(a, [34, 33, 33]);
  assert.deepEqual(allocate(1_000_001, [3, 1]), [750_001, 250_000]);
  assert.equal(allocate(500, [0, 0]), null); assert.equal(allocate(500, []), null);
  assert.deepEqual(fullMonths('2026-10-15', '2026-12-31'), ['2026-11', '2026-12']);
  assert.deepEqual(fullMonths('2026-11-01', '2026-11-29'), []);
  assert.equal(isMonthEnd('2026-11-30'), true); assert.equal(isMonthEnd('2026-02-28'), true); assert.equal(isMonthEnd('2026-11-29'), false);
});

test('API: lương + thưởng Sale từ bảng lương phân bổ theo doanh thu đủ giá vốn; tổng phân bổ + chưa phân bổ = bảng lương; tháng lẻ không tính', async () => {
  const f = await setupLiquidation(), stamp = '2026-11-10T03:00:00Z';
  // emp = Sale có 2 đơn tháng 11 (đủ giá vốn); 'old' = Sale không có đơn → chưa phân bổ.
  await f.db.insert(productMovements).values({ id: 'p1', refKey: 'buy-p1', sku: 'B', kind: 'purchase', qty: 10, unitPrice: 100000, occurredAt: '2026-10-01T00:00:00Z', recordedAt: '2026-10-01T00:00:00Z' });
  const order = (id: string, day: string, qty: number) => ({ id, orderNo: 'DH-' + id, quoteType: 'HRC', customerName: 'Khách ' + id, ownerId: 'emp', createdBy: 'emp', orderDate: day,
    status: 'confirmed', total: qty * 150000, subtotal: qty * 150000, createdAt: stamp, updatedAt: stamp }) as typeof salesOrders.$inferInsert;
  await f.db.insert(salesOrders).values([order('a', '2026-11-05', 1), order('b', '2026-11-20', 3)]);
  await f.db.insert(salesOrderLines).values([
    { id: 'la', orderId: 'a', lineNo: 1, sku: 'B', name: 'Bình', qty: 1, unitPrice: 150000, amount: 150000 },
    { id: 'lb', orderId: 'b', lineNo: 1, sku: 'B', name: 'Bình', qty: 3, unitPrice: 150000, amount: 450000 }]);
  for (const id of ['emp', 'old']) ok(await f.call(`/hr/members/${id}/salary`, f.mgr, 'PUT', { effectiveMonth: '2026-11', payrollGroup: 'sale', baseSalary: 5_200_000, responsibilityMode: 'fixed', responsibility: 1_000_000 }));
  for (const id of ['emp', 'old']) ok(await f.call(`/hr/members/${id}/inputs/2026-11`, f.mgr, 'PUT', { workDays: 26 }));
  const d = ok(await f.call('/profit?from=2026-11-01&to=2026-11-30', f.mgr));
  const st = d.staff;
  assert.equal(st.available, true); assert.deepEqual(st.months, ['2026-11']); assert.equal(st.partial, false);
  assert.ok(st.payroll.salary > 0, JSON.stringify(st));
  assert.equal(st.reconcile.ok, true, 'phân bổ + chưa phân bổ = bảng lương');
  assert.equal(st.reconcile.allocated + st.reconcile.unallocated, st.reconcile.payroll);
  assert.ok(st.unallocated.some((u: any) => u.memberId === 'old' && u.reason));
  const a = d.orders.find((o: any) => o.id === 'a'), b = d.orders.find((o: any) => o.id === 'b');
  assert.equal(a.staffCost + b.staffCost, st.reconcile.allocated, 'chỉ đơn của emp nhận chi phí');
  assert.ok(Math.abs(b.staffCost - 3 * a.staffCost) <= 2, 'tỉ lệ theo doanh thu đủ giá vốn 1:3');
  assert.equal(b.net, b.gross - b.staffCost);
  assert.equal(d.summary.net, d.summary.gross + d.summary.feeRevenue - d.summary.carrierFee - d.summary.staffSalary - d.summary.staffBonus);
  // Lọc theo nhân viên khác: chưa phân bổ chỉ còn của người đó; đối soát toàn công ty không đổi.
  const only = ok(await f.call('/profit?from=2026-11-01&to=2026-11-30&owner=old', f.mgr));
  assert.equal(only.staff.unallocated.length, 1); assert.equal(only.staff.reconcile.ok, true);
  // Kỳ lẻ tháng: chưa tính chi phí nhân sự.
  const half = ok(await f.call('/profit?from=2026-11-01&to=2026-11-15', f.mgr));
  assert.equal(half.staff.partial, true); assert.equal(half.staff.reconcile.payroll, 0); assert.equal(half.summary.staffSalary, 0);
  // Nhân viên không xem được.
  assert.equal((await f.call('/profit?from=2026-11-01&to=2026-11-30', f.emp)).status, 403);
});
