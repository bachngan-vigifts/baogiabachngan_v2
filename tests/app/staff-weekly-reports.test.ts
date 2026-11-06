import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupLiquidation } from '../helpers/liquidation-fixture.ts';
import { PASSWORD } from '../helpers/staff-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { staffWeeklyReports, staffWeeklyReportVersions } from '../../src/modules/staff-reports/schema.ts';

/** Báo cáo tuần Sale / Sale Admin: quyền, nháp / nộp chính thức, lịch sử, duyệt, điểm và Tiền trách nhiệm trong bảng lương. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const at = (vnLocal: string) => new Date(vnLocal + '+07:00').getTime();
const inputs = { highlights: 'Chốt 2 đơn quà Tết', keyCustomers: 'Cty A – chờ duyệt mẫu', nextWeekPlan: 'Gửi 5 báo giá mới', support: '' };
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

test('điểm tháng → Tiền trách nhiệm = mức × công/công chuẩn × điểm/4 từ 12/2026; trước 12/2026 giữ cách cũ; thử việc không áp dụng', async t => {
  const f = await setup(t);
  ok(await f.salary());
  ok(await f.call('/hr/members/emp/inputs/2026-12', f.s.mgr, 'PUT', { workDays: 26 }));
  ok(await f.call('/hr/members/emp/inputs/2026-11', f.s.mgr, 'PUT', { workDays: 13 }));
  await f.relog('2026-12-07T09:00:00'); ok(await f.submit('2026-11-30'), 201);                // đúng hạn: 1
  await f.relog('2026-12-14T17:00:00'); ok(await f.submit('2026-12-07'), 201);                // trễ < 1 ngày: 0,5
  await f.relog('2026-12-23T10:00:00'); const late = ok(await f.submit('2026-12-14'), 201);   // trễ 2 ngày: 0
  await f.relog('2026-12-29T12:00:00');                                                       // tuần 21/12 không nộp: 0
  let line = responsibility(await f.slip('2026-12'));
  assert.equal(line.amount, 975_000, JSON.stringify(line)); assert.match(line.note, /1,5\/4 điểm báo cáo tuần/);
  const review = ok(await f.call('/staff-reports/review?month=2026-12', f.s.mgr));
  assert.deepEqual(review.weeks, ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  assert.deepEqual(review.people.find((p: any) => p.id === 'emp').weeks.map((w: any) => w.score), [1, 0.5, 0, 0]);
  ok(await f.call(`/staff-reports/${late.id}/review`, f.s.mgr, 'POST', { review: 'excused', note: 'Nghỉ phép có duyệt' }));
  assert.equal(responsibility(await f.slip('2026-12')).amount, 1_625_000, 'Miễn = 1 điểm');
  assert.equal(responsibility(await f.slip('2026-11')).amount, 2_600_000, 'tháng 11/2026 chưa áp dụng: giữ cách tính cũ');
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
  assert.equal(me.weeks.length, 5); assert.equal(me.points, 4);
  assert.equal(responsibility(await f.slip('2027-03')).amount, 2_600_000);
});
