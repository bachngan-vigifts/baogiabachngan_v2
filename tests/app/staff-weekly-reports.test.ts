import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupLiquidation } from '../helpers/liquidation-fixture.ts';
import { PASSWORD } from '../helpers/staff-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { staffWeeklyReports, staffWeeklyReportVersions } from '../../src/modules/staff-reports/schema.ts';
import { deliveries, paymentSchedules, salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { customerActivities } from '../../src/modules/care/schema.ts';

/** Báo cáo tuần Sale / Sale Admin: quyền, nháp / nộp chính thức, lịch sử, duyệt, điểm và Tiền trách nhiệm trong bảng lương. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const at = (vnLocal: string) => new Date(vnLocal + '+07:00').getTime();
const inputs = { highlights: 'Chốt 2 đơn quà Tết', nextWeekPlan: 'Gửi 5 báo giá mới', support: '' };
const responsibility = (slip: any) => slip.income.find((l: any) => l.key === 'responsibility');

async function setup(t: TestContext) {
  const f = await setupLiquidation();
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-12-01T09:00:00') });
  const login = async (email: string) => (await f.call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const s = { mgr: '', emp: '', other: '' };
  const relog = async (vn: string) => { t.mock.timers.setTime(at(vn)); s.mgr = await login('mgr@x.vn'); s.emp = await login('emp@x.vn'); s.other = await login('new@x.vn'); };
  await relog('2026-12-01T09:00:00');
  const submit = (period: string, extra: Record<string, unknown> = {}) =>
    f.call('/staff-reports', s.emp, 'POST', { period, clientKey: crypto.randomUUID(), inputs, ...extra });
  const salary = (extra = {}) => f.call('/hr/members/emp/salary', s.mgr, 'PUT', { effectiveMonth: '2026-10', payrollGroup: 'sale', baseSalary: 5_000_000, responsibilityMode: 'fixed', responsibility: 2_600_000, ...extra });
  const slip = async (month: string) => ok(await f.call(`/members/emp/overview?month=${month}`, s.mgr)).payroll.payslip;
  return { ...f, s, relog, submit, salary, slip };
}

test('chỉ Sale / Sale Admin nộp; người khác 403; Manager mới xem người khác và duyệt', async t => {
  const f = await setup(t);
  assert.equal(ok(await f.call('/staff-reports/me', f.s.other)).required, false, 'chức vụ khác không phải nộp');
  assert.equal(ok(await f.call('/staff-reports/me', f.s.mgr)).canReview, true);
  assert.equal((await f.call('/staff-reports', f.s.other, 'POST', { period: '2026-11-23', clientKey: crypto.randomUUID(), inputs })).status, 403);
  assert.equal((await f.call('/staff-reports/draft', f.s.other, 'PUT', { period: '2026-11-30', inputs })).status, 403);
  assert.equal((await f.call('/staff-reports/week?period=2026-11-23&memberId=emp', f.s.other)).status, 403);
  assert.equal((await f.call('/staff-reports/review?month=2026-12', f.s.emp)).status, 403);
  const id = ok(await f.submit('2026-11-23'), 201).id;
  assert.equal((await f.call(`/staff-reports/${id}/review`, f.s.emp, 'POST', { review: 'ok' })).status, 403);
  assert.equal((await f.call(`/staff-reports/${id}/review`, f.s.mgr, 'POST', { review: 'rejected' })).status, 400, 'Chưa đạt phải có lý do');
  ok(await f.call(`/staff-reports/${id}/review`, f.s.mgr, 'POST', { review: 'ok' }));
  const view = ok(await f.call('/staff-reports/week?period=2026-11-23&memberId=emp', f.s.mgr));
  assert.equal(view.report.review, 'ok'); assert.equal(view.canEdit, false); assert.equal(view.draft, null, 'Manager không thấy nháp của người khác');
  // Sale Admin cũng phải nộp.
  await f.db.update(employees).set({ positionId: 'sale-admin' }).where(eq(employees.id, 'new'));
  assert.equal(ok(await f.call('/staff-reports/me', f.s.other)).required, true);
});

test('nháp không tính; tuần chưa hết 409 WEEK_OPEN; bắt buộc 3 mục; số liệu tính ở máy chủ; nộp lại giữ giờ đầu + lưu lịch sử; đã duyệt thì khoá', async t => {
  const f = await setup(t);
  await f.relog('2026-12-03T10:00:00');
  ok(await f.call('/staff-reports/draft', f.s.emp, 'PUT', { period: '2026-11-30', inputs: { highlights: 'Nháp' } }));
  const open = await f.submit('2026-11-30');
  assert.equal(open.status, 409); assert.equal(open.data.code, 'WEEK_OPEN');
  assert.equal((await f.call('/staff-reports/draft', f.s.emp, 'PUT', { period: '2026-12-07', inputs })).status, 400, 'tuần chưa bắt đầu');
  let me = ok(await f.call('/staff-reports/me?month=2026-12', f.s.emp));
  assert.equal(me.weeks[0].period, '2026-11-30'); assert.ok(me.weeks[0].draftAt); assert.equal(me.weeks[0].submittedAt, null); assert.equal(me.points, 0);

  await f.relog('2026-12-07T09:00:00');
  assert.equal((await f.submit('2026-11-30', { inputs: { ...inputs, nextWeekPlan: '' } })).status, 400, 'thiếu kế hoạch tuần tới');
  const first = ok(await f.submit('2026-11-30', { facts: { revenue: 999_999_999 } }), 201);
  const [row] = await f.db.select().from(staffWeeklyReports).where(eq(staffWeeklyReports.id, first.id));
  assert.equal(JSON.parse(row!.data).facts.revenue, 0, 'bỏ qua số liệu client gửi');
  assert.equal(first.state.state, 'on_time');
  me = ok(await f.call('/staff-reports/me?month=2026-12', f.s.emp));
  assert.equal(me.weeks[0].draftAt, null, 'nộp chính thức xoá nháp'); assert.equal(me.points, 1);

  await f.relog('2026-12-08T15:00:00');
  const again = ok(await f.submit('2026-11-30', { inputs: { ...inputs, highlights: 'Bổ sung thêm 1 đơn' } }));
  assert.equal(again.version, 2); assert.equal(again.state.state, 'on_time', 'nộp lại sau hạn giữ trạng thái lần đầu');
  const [kept] = await f.db.select().from(staffWeeklyReports).where(eq(staffWeeklyReports.id, first.id));
  assert.equal(kept!.submittedAt, row!.submittedAt);
  assert.equal((await f.db.select().from(staffWeeklyReportVersions).where(eq(staffWeeklyReportVersions.reportId, first.id))).length, 2);
  ok(await f.call(`/staff-reports/${first.id}/review`, f.s.mgr, 'POST', { review: 'ok' }));
  assert.equal((await f.submit('2026-11-30')).status, 409, 'đã duyệt không nộp lại');
  assert.equal((await f.call('/staff-reports/draft', f.s.emp, 'PUT', { period: '2026-11-30', inputs })).status, 409);
});

test('điểm tháng → Tiền trách nhiệm = mức × công/công chuẩn × điểm/5 (4 tuần + tháng) từ 11/2026; trước 11/2026 giữ cách cũ; thử việc không áp dụng', async t => {
  const f = await setup(t);
  ok(await f.salary());
  ok(await f.call('/hr/members/emp/inputs/2026-12', f.s.mgr, 'PUT', { workDays: 26 }));
  ok(await f.call('/hr/members/emp/inputs/2026-10', f.s.mgr, 'PUT', { workDays: 13 }));
  await f.relog('2026-12-07T09:00:00'); ok(await f.submit('2026-11-30'), 201);                // đúng hạn: 1
  await f.relog('2026-12-14T17:00:00'); ok(await f.submit('2026-12-07'), 201);                // trễ < 1 ngày: 0,5
  await f.relog('2026-12-23T10:00:00'); const late = ok(await f.submit('2026-12-14'), 201);   // trễ 2 ngày: 0
  await f.relog('2026-12-29T12:00:00');                                                       // tuần 21/12 không nộp: 0
  let line = responsibility(await f.slip('2026-12'));
  assert.equal(line.amount, 780_000, JSON.stringify(line)); assert.match(line.note, /1,5\/5 điểm báo cáo \(4 tuần \+ tháng\)/, 'chưa nộp báo cáo tháng: 1,5 / 5');
  const review = ok(await f.call('/staff-reports/review?month=2026-12', f.s.mgr));
  assert.deepEqual(review.weeks, ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  assert.deepEqual(review.people.find((p: any) => p.id === 'emp').weeks.map((w: any) => w.score), [1, 0.5, 0, 0]);
  ok(await f.call(`/staff-reports/${late.id}/review`, f.s.mgr, 'POST', { review: 'excused', note: 'Nghỉ phép có duyệt' }));
  assert.equal(responsibility(await f.slip('2026-12')).amount, 1_300_000, 'Miễn = 1 điểm → 2,5 / 5');
  assert.equal(responsibility(await f.slip('2026-10')).amount, 2_600_000, 'tháng 10/2026 chưa áp dụng: giữ cách tính cũ');
  ok(await f.salary({ positionLabel: 'TV' }));
  const probation = responsibility(await f.slip('2026-12'));
  assert.equal(probation.amount, 0); assert.doesNotMatch(probation.note, /báo cáo tuần/, 'thử việc: không có trách nhiệm, không dùng điểm báo cáo tuần');
});

test('tháng 5 tuần lấy 4 tuần điểm cao nhất', async t => {
  const f = await setup(t);
  ok(await f.salary());
  ok(await f.call('/hr/members/emp/inputs/2027-03', f.s.mgr, 'PUT', { workDays: 26 }));
  // Hạn thứ Hai trong 3/2027: 01, 08, 15, 22, 29 → 5 tuần (22/02 … 22/03).
  for (const [period, when] of [['2027-02-22', '2027-03-01T09:00:00'], ['2027-03-01', '2027-03-08T09:00:00'], ['2027-03-08', '2027-03-15T09:00:00'], ['2027-03-15', '2027-03-22T09:00:00']] as const) {
    await f.relog(when); ok(await f.submit(period), 201);
  }
  await f.relog('2027-03-31T09:00:00');
  const me = ok(await f.call('/staff-reports/me?month=2027-03', f.s.emp));
  assert.equal(me.weeks.length, 5); assert.equal(me.points, 4); assert.equal(me.maxPoints, 5);
  assert.equal(responsibility(await f.slip('2027-03')).amount, 2_080_000, '4 tuần đủ, thiếu báo cáo tháng: 4 / 5');
});

test('số liệu tuần: đơn chốt, báo giá trong tuần (bắt buộc ghi tình trạng báo giá chưa chốt), chăm sóc theo ngành, giao hàng, công nợ', async t => {
  const f = await setup(t), stamp = '2026-12-02T03:00:00Z';
  await f.db.insert(customers).values([
    { id: 'c-bank', name: 'Agribank CN Bến Tre', search: '', syncedAt: '', contact: '', phone: '', email: '', address: '', sourceVersion: 0 },
    { id: 'c-agri', name: 'Công ty ABC', customerType: 'Phân bón', search: '', syncedAt: '', contact: '', phone: '', email: '', address: '', sourceVersion: 0 }]);
  await f.db.insert(salesOrders).values([
    { id: 'o-old', orderNo: 'DH-OLD', quoteType: 'HRC', customerId: 'c-bank', customerName: 'Agribank CN Bến Tre', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-10', status: 'confirmed', total: 8_640_000, subtotal: 8_000_000, createdAt: stamp, updatedAt: stamp },
    { id: 'o-week', orderNo: 'DH-WEEK', quoteType: 'HRC', customerId: 'c-bank', customerName: 'Agribank CN Bến Tre', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-12-02', status: 'confirmed', total: 32_076_000, subtotal: 29_700_000, createdAt: stamp, updatedAt: stamp },
    { id: 'o-other', orderNo: 'DH-MGR', quoteType: 'HRC', customerName: 'Khách người khác', ownerId: 'mgr', createdBy: 'mgr', orderDate: '2026-12-02', status: 'confirmed', total: 99_000_000, subtotal: 99_000_000, createdAt: stamp, updatedAt: stamp }]);
  await f.db.insert(salesOrderLines).values([
    { id: 'l1', orderId: 'o-week', lineNo: 1, sku: '', name: 'Bộ 10 chén cơm', qty: 100, unitPrice: 297_000, amount: 29_700_000 },
    { id: 'l2', orderId: 'o-week', lineNo: 2, sku: '', name: 'Túi vải', qty: 100, unitPrice: 18_700, amount: 1_870_000 }]);
  await f.db.insert(paymentSchedules).values([
    { id: 's-old', orderId: 'o-old', kind: 'balance', amount: 8_640_000, dueDate: '2026-11-20', createdAt: stamp },
    { id: 's-week', orderId: 'o-week', kind: 'balance', amount: 32_076_000, dueDate: '2026-12-31', createdAt: stamp },
    { id: 's-other', orderId: 'o-other', kind: 'balance', amount: 99_000_000, dueDate: '2026-11-01', createdAt: stamp }]);
  await f.db.insert(deliveries).values({ id: 'd1', deliveryNo: 'GH-1', orderId: 'o-week', plannedDate: '2026-12-14', createdBy: 'emp', createdAt: stamp, updatedAt: stamp });
  await f.db.insert(quotations).values([
    { id: 'q-open', creatorId: 'emp', quoteNo: 'BG-OPEN', quoteType: 'HRC', customer: 'Vietcombank KG', quoteDate: '2026-12-03', data: '{"rows":[]}', createdAt: stamp, updatedAt: stamp },
    { id: 'q-won', creatorId: 'emp', quoteNo: 'BG-WON', quoteType: 'HRC', customer: 'Agribank CN Bến Tre', quoteDate: '2026-12-01', data: '{"rows":[]}', createdAt: stamp, updatedAt: stamp }]);
  await f.db.update(salesOrders).set({ quoteId: 'q-won' }).where(eq(salesOrders.id, 'o-week'));
  const act = (id: string, customerId: string) => ({ id, customerId, ownerId: 'emp', type: 'call', completion: 'completed', purpose: 'sales', result: 'consulting', content: 'Trao đổi nhu cầu quà Tết', contactName: 'Chị A', occurredAt: '2026-12-03T03:00:00Z', createdAt: stamp, updatedAt: stamp }) as typeof customerActivities.$inferInsert;
  await f.db.insert(customerActivities).values([act('a1', 'c-bank'), act('a2', 'c-agri')]);

  await f.relog('2026-12-07T09:00:00');
  const week = ok(await f.call('/staff-reports/week?period=2026-11-30', f.s.emp)).facts;
  assert.equal(week.revenue, 32_076_000, 'không lấy đơn người khác');
  assert.deepEqual(week.orderList, [{ orderNo: 'DH-WEEK', customerName: 'Agribank CN Bến Tre', total: 32_076_000, items: '100 Bộ 10 chén cơm + 100 Túi vải' }]);
  assert.deepEqual(week.quotes.map((q: any) => [q.quoteNo, q.won]).sort(), [['BG-OPEN', false], ['BG-WON', true]]);
  const care = Object.fromEntries(week.care.filter((g: any) => g.activities).map((g: any) => [g.industry, [g.oldCustomers, g.newCustomers]]));
  assert.deepEqual(care, { bank: [1, 0], agri: [0, 1] }, 'KH cũ = đã có đơn trước tuần; ngành theo tên / loại khách');
  assert.deepEqual(week.deliveries.map((d: any) => d.orderNo), ['DH-WEEK']);
  assert.deepEqual(week.receivables.map((r: any) => [r.orderNo, r.overdue]), [['DH-OLD', 8_640_000], ['DH-WEEK', 0]], 'quá hạn lên đầu; không có công nợ người khác');
  assert.equal(week.receivableTotals.balance, 40_716_000);

  const missing = await f.submit('2026-11-30');
  assert.equal(missing.status, 400); assert.match(missing.data.error ?? missing.data.message ?? JSON.stringify(missing.data), /BG-OPEN/);
  const done = ok(await f.submit('2026-11-30', { inputs: { ...inputs, quoteNotes: { 'q-open': 'Chị Dương đang trình Sếp', 'la': 'không thuộc tuần' } } }), 201);
  const [row] = await f.db.select().from(staffWeeklyReports).where(eq(staffWeeklyReports.id, done.id));
  assert.deepEqual(JSON.parse(row!.data).inputs.quoteNotes, { 'q-open': 'Chị Dương đang trình Sếp' });
});

test('tháng 11/2026 áp dụng; tuần 26/10–01/11 (hạn trước ngày triển khai 06/11) tính Miễn 1 điểm, không nhắc', async t => {
  const f = await setup(t);
  ok(await f.salary());
  ok(await f.call('/hr/members/emp/inputs/2026-11', f.s.mgr, 'PUT', { workDays: 26 }));
  await f.relog('2026-11-06T09:00:00');
  let me = ok(await f.call('/staff-reports/me?month=2026-11', f.s.emp));
  assert.equal(me.applies, true); assert.equal(me.remind, null, 'tuần trước ngày triển khai không nhắc');
  assert.deepEqual(me.weeks.map((w: any) => [w.period, w.state, w.score]).slice(0, 2), [['2026-10-26', 'exempt', 1], ['2026-11-02', 'not_due', null]]);
  await f.relog('2026-11-09T09:00:00'); ok(await f.submit('2026-11-02'), 201);
  await f.relog('2026-12-01T09:00:00');
  me = ok(await f.call('/staff-reports/me?month=2026-11', f.s.emp));
  assert.equal(me.weeks.length, 5); assert.equal(me.points, 2, 'Miễn 1 + đúng hạn 1; 3 tuần còn lại + báo cáo tháng không nộp');
  assert.equal(responsibility(await f.slip('2026-11')).amount, 1_040_000);
});

test('báo cáo tháng: hạn 10h ngày 02 tháng sau, bắt buộc 4 mục, số liệu tháng + thưởng KPI dự kiến từ bảng lương, cộng 1 điểm (÷5)', async t => {
  const f = await setup(t), stamp = '2026-11-10T03:00:00Z';
  ok(await f.salary());
  ok(await f.call('/hr/members/emp/inputs/2026-11', f.s.mgr, 'PUT', { workDays: 26 }));
  await f.db.insert(salesOrders).values([
    { id: 'm-1', orderNo: 'DH-M1', quoteType: 'HRC', customerName: 'Agribank CN Bến Tre', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-10', status: 'confirmed', total: 30_000_000, subtotal: 30_000_000, createdAt: stamp, updatedAt: stamp },
    { id: 'm-2', orderNo: 'DH-M2', quoteType: 'HRC', customerName: 'Công ty Phân bón X', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-20', status: 'confirmed', total: 10_000_000, subtotal: 10_000_000, createdAt: stamp, updatedAt: stamp },
    { id: 'm-prev', orderNo: 'DH-M0', quoteType: 'HRC', customerName: 'Agribank CN Bến Tre', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-10-05', status: 'confirmed', total: 20_000_000, subtotal: 20_000_000, createdAt: stamp, updatedAt: stamp }]);
  const monthly = { evaluation: 'Đạt nhờ khối ngân hàng', nextTarget: '450.000.000', keyCustomers: 'Vietcombank KG; Agribank', plan: 'Quà Tết khối ngân hàng', support: '' };
  await f.relog('2026-11-20T09:00:00');
  ok(await f.call('/staff-reports/draft', f.s.emp, 'PUT', { period: '2026-11', inputs: { evaluation: 'Nháp' } }));
  const open = await f.call('/staff-reports', f.s.emp, 'POST', { period: '2026-11', clientKey: crypto.randomUUID(), inputs: monthly });
  assert.equal(open.status, 409); assert.equal(open.data.code, 'MONTH_OPEN');
  assert.equal((await f.call('/staff-reports/week?period=2026-10', f.s.emp)).status, 400, 'trước 11/2026 không có báo cáo tháng');
  await f.relog('2026-12-01T09:00:00');
  const view = ok(await f.call('/staff-reports/week?period=2026-11', f.s.emp));
  assert.equal(view.kind, 'monthly'); assert.equal(view.deadline, new Date('2026-12-02T10:00:00+07:00').toISOString());
  assert.equal(view.facts.revenue, 40_000_000); assert.equal(view.facts.prevRevenue, 20_000_100, 'gồm đơn mẫu 100đ ngày 31/10 của fixture');
  assert.deepEqual(view.facts.industries.map((x: any) => [x.industry, x.revenue]), [['bank', 30_000_000], ['agri', 10_000_000]]);
  assert.equal(view.facts.topCustomers[0].name, 'Agribank CN Bến Tre');
  assert.ok(view.facts.payroll, 'thưởng KPI dự kiến từ bảng lương'); assert.equal(typeof view.facts.payroll.bonus.amount, 'number');
  assert.ok(view.facts.payroll.bonus.tiers.length >= 2);
  assert.equal((await f.call('/staff-reports', f.s.emp, 'POST', { period: '2026-11', clientKey: crypto.randomUUID(), inputs: { ...monthly, plan: '' } })).status, 400);
  assert.equal((await f.call('/staff-reports', f.s.emp, 'POST', { period: '2026-11', clientKey: crypto.randomUUID(), inputs: { ...monthly, nextTarget: '' } })).status, 400);
  const done = ok(await f.call('/staff-reports', f.s.emp, 'POST', { period: '2026-11', clientKey: crypto.randomUUID(), inputs: monthly, facts: { revenue: 1 } }), 201);
  assert.equal(done.state.state, 'on_time');
  const [row] = await f.db.select().from(staffWeeklyReports).where(eq(staffWeeklyReports.id, done.id));
  const saved = JSON.parse(row!.data); assert.equal(saved.kind, 'monthly'); assert.equal(saved.facts.revenue, 40_000_000); assert.equal(saved.inputs.nextTarget, 450_000_000);
  const me = ok(await f.call('/staff-reports/me?month=2026-11', f.s.emp));
  assert.equal(me.maxPoints, 5); assert.equal(me.monthly.state, 'on_time'); assert.equal(me.monthly.score, 1); assert.equal(me.points, 2, 'tuần 26/10 Miễn 1 + báo cáo tháng 1');
  assert.equal(responsibility(await f.slip('2026-11')).amount, 1_040_000);
  const review = ok(await f.call('/staff-reports/review?month=2026-11', f.s.mgr));
  assert.equal(review.hasMonthly, true); assert.equal(review.people.find((p: any) => p.id === 'emp').monthly.reportId, done.id);
  ok(await f.call(`/staff-reports/${done.id}/review`, f.s.mgr, 'POST', { review: 'rejected', note: 'Đánh giá sơ sài' }));
  assert.equal(responsibility(await f.slip('2026-11')).amount, 520_000, 'Chưa đạt → 0 điểm tháng');
  assert.equal((await f.call('/staff-reports/week?period=2026-11&memberId=emp', f.s.other)).status, 403);
});
