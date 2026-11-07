import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';
import { classifyCashEntry } from '../../src/modules/profit/domain/branch-costs.ts';

/** Chi phí chi nhánh: phân loại phiếu két (không phải phiếu chi nào cũng là chi phí), lương NVBH theo ca, chi phí chung, đối soát công ty. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('domain: chỉ chi vặt hoạt động là chi phí; tạm ứng / nộp két / hoàn tiền / thu khác / điều chỉnh không; chi vặt ghi lương / GHN / NCC cần xác nhận', () => {
  assert.equal(classifyCashEntry({ kind: 'petty_expense', reason: 'Tên phiếu: Mua văn phòng phẩm\n\nGiấy in' }), 'operating');
  assert.equal(classifyCashEntry({ kind: 'petty_expense', reason: 'Trả lương thời vụ tháng 11' }), 'payroll');
  assert.equal(classifyCashEntry({ kind: 'petty_expense', reason: 'Trả phí GHN đơn POS-118' }), 'carrier');
  assert.equal(classifyCashEntry({ kind: 'petty_expense', reason: 'Trả NCC tiền hàng' }), 'supplier');
  assert.equal(classifyCashEntry({ kind: 'advance', reason: 'Ứng lương' }), 'advance');
  assert.equal(classifyCashEntry({ kind: 'cash_out', reason: 'Nộp két' }), 'transfer');
  assert.equal(classifyCashEntry({ kind: 'customer_refund', reason: 'x' }), 'refund');
  assert.equal(classifyCashEntry({ kind: 'other_income', reason: 'x' }), 'other_income');
  assert.equal(classifyCashEntry({ kind: 'adjustment', reason: 'x' }), 'adjustment');
});

test('API: chi vặt hoạt động trừ vào chi nhánh; lương NVBH chia theo ca; đối soát công ty và bảng lương khớp; lọc thì ẩn số toàn công ty', async () => {
  const f = await setup();
  await f.open();
  const entry = (kind: string, reason: string, amount = 100) => f.call('/cash/entries', f.emp, 'POST', { key: crypto.randomUUID(), kind, reason, amount });
  for (const [kind, reason] of [['petty_expense', 'Mua văn phòng phẩm'], ['petty_expense', 'Trả lương thời vụ'], ['advance', 'Ứng lương'], ['other_income', 'Bán ve chai']] as const)
    assert.equal((await entry(kind, reason)).status, 201);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number], last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  ok(await f.call('/hr/members/emp/salary', f.mgr, 'PUT', { effectiveMonth: month, payrollGroup: 'lock', baseSalary: 5_200_000 }));
  ok(await f.call(`/hr/members/emp/inputs/${month}`, f.mgr, 'PUT', { workDays: 26 }));
  const d = ok(await f.call(`/profit?from=${month}-01&to=${last}`, f.mgr));
  const bc = d.branchCosts;
  const reg = bc.rows.find((r: any) => r.id === f.registerId);
  assert.equal(reg.petty, 100, 'chỉ phiếu "Mua văn phòng phẩm"');
  assert.ok(reg.staff > 0, 'lương NVBH vào quầy có ca');
  assert.equal(reg.net, reg.ordersNet - reg.petty - reg.staff);
  assert.deepEqual(bc.cash.map((x: any) => [x.cls, x.counted]).sort(), [['advance', false], ['operating', true], ['other_income', false], ['payroll', false]]);
  assert.equal(bc.review.length, 1); assert.match(bc.review[0].reason, /lương/);
  assert.equal(bc.officeExpenses.available, false);
  const co = bc.company;
  assert.equal(co.reconcile.ok, true, 'Σ đơn − chi phí chi nhánh − chưa phân bổ − chung = LN công ty');
  assert.equal(co.reconcile.payrollOk, true, 'bảng lương = Sale + quầy + chung');
  assert.equal(co.net, co.reconcile.branches - co.saleUnallocated - co.overhead);
  const filtered = ok(await f.call(`/profit?from=${month}-01&to=${last}&branch=${f.registerId}`, f.mgr));
  assert.equal(filtered.branchCosts.company, null, 'lọc chi nhánh: không hiện số toàn công ty');
  assert.equal(filtered.branchCosts.rows.length, 1);
});

test('Manager sửa loại phiếu két: thắng phân loại tự động, đổi chi phí chi nhánh, bỏ thì quay về tự động; chỉ Manager', async () => {
  const f = await setup();
  await f.open();
  const entry = (kind: string, reason: string, amount: number) => f.call('/cash/entries', f.emp, 'POST', { key: crypto.randomUUID(), kind, reason, amount });
  assert.equal((await entry('petty_expense', 'Trả lương thời vụ', 300)).status, 201);
  assert.equal((await entry('petty_expense', 'Mua văn phòng phẩm', 100)).status, 201);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), q = `/profit?from=${today}&to=${today}`;
  const petty = (d: any) => d.branchCosts.rows.reduce((n: number, r: any) => n + r.petty, 0);
  const before = ok(await f.call(q, f.mgr));
  assert.equal(petty(before), 100, 'tự động: chỉ chi vặt hoạt động');
  assert.equal(before.cache.hit, false);
  // Xem lại trong 30 phút: lấy bản tính sẵn (mọi Manager dùng chung); sửa loại phiếu bên dưới phải bỏ bản này.
  const again = ok(await f.call(q, f.mgr));
  assert.equal(again.cache.hit, true); assert.equal(again.cache.computedAt, before.cache.computedAt); assert.equal(petty(again), 100);
  assert.equal((await f.call(q, f.emp)).status, 403, 'bản tính sẵn không mở quyền cho nhân viên');
  const item = before.branchCosts.review.find((r: any) => r.amount === 300);
  assert.deepEqual([item.cls, item.auto, item.manual], ['payroll', 'payroll', false]);
  assert.ok(before.branchCosts.classOptions.some((o: any) => o.cls === 'operating' && o.counted));
  assert.equal((await f.call(`/profit/cash-classes/${item.id}`, f.emp, 'PUT', { cls: 'operating' })).status, 403);
  assert.equal((await f.call(`/profit/cash-classes/${item.id}`, f.mgr, 'PUT', { cls: 'xyz' })).status, 400);
  assert.equal((await f.call('/profit/cash-classes/khong-co', f.mgr, 'PUT', { cls: 'operating' })).status, 404);
  ok(await f.call(`/profit/cash-classes/${item.id}`, f.mgr, 'PUT', { cls: 'operating', note: 'Thực ra là tiền thuê bốc xếp' }));
  const after = ok(await f.call(q, f.mgr));
  assert.equal(after.cache.hit, false, 'sửa loại phiếu két bỏ bản tính sẵn');
  assert.equal(petty(after), 400, 'Manager xác nhận là chi phí hoạt động → tính vào chi nhánh');
  assert.deepEqual(['cls', 'auto', 'manual'].map(k => after.branchCosts.review.find((r: any) => r.id === item.id)[k]), ['operating', 'payroll', true], 'vẫn hiện trong danh sách để xem lại');
  ok(await f.call(`/profit/cash-classes/${item.id}`, f.mgr, 'PUT', { cls: '' }));
  assert.equal(petty(ok(await f.call(q, f.mgr))), 100, 'bỏ → quay về tự phân loại');
});

