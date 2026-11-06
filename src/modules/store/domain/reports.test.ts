import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyFails, deadlineOf, isPeriod, mondayOf, remindersAt as remindersAtLaunch, responsibilityOf as responsibilityAtLaunch, slotState as slotStateAtLaunch, weeksDueIn, weeklyFails, type ReportRow } from './reports.ts';
// Các test logic chung dùng ngày mẫu tháng 10–11/2026: tắt mốc ngày triển khai để không lẫn quy tắc "miễn trước triển khai".
const slotState = (...a: [Parameters<typeof slotStateAtLaunch>[0], string, string | null, string]) => slotStateAtLaunch(...a, '');
const responsibilityOf = (a: Parameters<typeof responsibilityAtLaunch>[0]) => responsibilityAtLaunch({ launchAt: '', ...a });
const remindersAt = (now: string, days: readonly string[], done: ReadonlySet<string>) => remindersAtLaunch(now, days, done, '');

test('hạn nộp theo giờ Việt Nam', () => {
  assert.equal(deadlineOf('daily', '2026-11-05'), '2026-11-05T15:00:00.000Z'); // 22h00 VN
  assert.equal(deadlineOf('weekly', '2026-11-02'), '2026-11-09T03:00:00.000Z'); // 10h00 thứ Hai tuần sau
  assert.equal(deadlineOf('monthly', '2026-11'), '2026-12-01T17:00:00.000Z'); // trước ngày 02/12
  assert.equal(deadlineOf('stocktake', '2026-12'), '2027-01-01T17:00:00.000Z');
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); assert.equal(mondayOf('2026-11-02'), '2026-11-02');
  assert.ok(isPeriod('weekly', '2026-11-02')); assert.ok(!isPeriod('weekly', '2026-11-03')); assert.ok(!isPeriod('daily', '2026-02-30')); assert.ok(isPeriod('monthly', '2026-11'));
});

test('trạng thái nộp: đúng hạn / trễ (số ngày) / thiếu / chưa tới hạn', () => {
  assert.deepEqual(slotState('daily', '2026-11-05', '2026-11-05T14:59:00Z', '2026-11-06T00:00:00Z'), { state: 'on_time', lateDays: 0 });
  assert.deepEqual(slotState('daily', '2026-11-05', '2026-11-05T15:01:00Z', '2026-11-06T00:00:00Z'), { state: 'late', lateDays: 1 });
  assert.equal(slotState('daily', '2026-11-05', null, '2026-11-05T14:00:00Z').state, 'not_due');
  assert.equal(slotState('daily', '2026-11-05', null, '2026-11-05T16:00:00Z').state, 'missing');
  assert.equal(slotState('monthly', '2026-11', '2026-12-03T10:00:00Z', '2026-12-10T00:00:00Z').lateDays, 2);
  assert.equal(dailyFails('late', 'cash_error'), 2); assert.equal(dailyFails('on_time', 'cash_error'), 2); assert.equal(dailyFails('missing', 'excused'), 0);
  assert.equal(weeklyFails('on_time', 'order_error'), 1); assert.equal(weeklyFails('late', 'ok'), 1);
});

const now = '2026-12-10T00:00:00Z';
const r = (kind: ReportRow['kind'], period: string, submittedAt: string | null, review: ReportRow['review'] = 'pending'): ReportRow => ({ kind, period, submittedAt, review });
const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
const onTime = (d: string) => new Date(Date.parse(d + 'T10:00:00Z')).toISOString();

test('Tiền Trách nhiệm: đủ 4 ngạch = 1.000.000', () => {
  const weeks = weeksDueIn('2026-11', days);
  const reports = [...days.map(d => r('daily', d, onTime(d))), ...weeks.map(w => r('weekly', w, deadlineOf('weekly', w).replace('03:00', '02:00'))),
    r('monthly', '2026-11', '2026-11-30T12:00:00Z'), r('stocktake', '2026-11', '2026-12-01T05:00:00Z')];
  const res = responsibilityOf({ month: '2026-11', dailyDays: days, weeks, reports, now });
  assert.equal(res.total, 1_000_000); assert.deepEqual(res.parts.map(p => p.amount), [250_000, 250_000, 250_000, 250_000]);
  assert.deepEqual(weeks, ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
});

test('Tiền Trách nhiệm: bậc theo số lần chưa đạt, sai sổ quỹ ×2, miễn không tính, tháng/kiểm kho trễ', () => {
  const daily = (bad: number, extra: ReportRow[] = []) => responsibilityOf({ month: '2026-11', dailyDays: days, weeks: [],
    reports: [...days.slice(bad).map(d => r('daily', d, onTime(d))), ...extra], now }).parts[0]!;
  assert.equal(daily(0).amount, 250_000); assert.equal(daily(2).amount, 150_000); assert.equal(daily(3).amount, 50_000); assert.equal(daily(4).amount, 50_000); assert.equal(daily(5).amount, 0);
  // 1 ngày thiếu + 1 ngày sai sổ quỹ = 3 lần → 50.000
  const cash = responsibilityOf({ month: '2026-11', dailyDays: days, weeks: [], now,
    reports: days.slice(1).map((d, i) => r('daily', d, onTime(d), i === 0 ? 'cash_error' : 'ok')) }).parts[0]!;
  assert.equal(cash.fails, 3); assert.equal(cash.amount, 50_000);
  // ngày thiếu nhưng được miễn
  const excused = responsibilityOf({ month: '2026-11', dailyDays: days, weeks: [], now, reports: [r('daily', days[0]!, null, 'excused'), ...days.slice(1).map(d => r('daily', d, onTime(d)))] }).parts[0]!;
  assert.equal(excused.amount, 250_000);
  const weekly = (n: number) => responsibilityOf({ month: '2026-11', dailyDays: [], weeks: ['2026-11-02', '2026-11-09', '2026-11-16'], now,
    reports: ['2026-11-02', '2026-11-09', '2026-11-16'].slice(n).map(w => r('weekly', w, '2026-11-01T00:00:00Z')) }).parts[1]!;
  assert.deepEqual([0, 1, 2, 3].map(n => weekly(n).amount), [250_000, 150_000, 50_000, 0]);
  const once = (kind: 'monthly' | 'stocktake', at: string | null, review: ReportRow['review'] = 'pending') =>
    responsibilityOf({ month: '2026-11', dailyDays: [], weeks: [], now, reports: at || review !== 'pending' ? [r(kind, '2026-11', at, review)] : [] }).parts[kind === 'monthly' ? 2 : 3]!.amount;
  assert.equal(once('monthly', '2026-12-01T16:00:00Z'), 250_000); assert.equal(once('monthly', '2026-12-03T16:00:00Z'), 100_000); assert.equal(once('monthly', '2026-12-05T00:00:00Z'), 0); assert.equal(once('monthly', null), 0);
  assert.equal(once('stocktake', '2026-12-03T16:00:00Z'), 150_000); assert.equal(once('stocktake', '2026-12-01T00:00:00Z', 'gap_unreported'), 0); assert.equal(once('stocktake', null, 'excused'), 250_000);
  // tháng chưa tới hạn → chưa trừ
  assert.equal(responsibilityOf({ month: '2026-12', dailyDays: [], weeks: [], reports: [], now }).total, 1_000_000);
});

test('nhắc nhở 30 phút: báo cáo ngày từ 19h, quá hạn 7 ngày, tuần từ 8h thứ Hai, tháng & kiểm kho', () => {
  const shift = ['2026-11-02', '2026-11-05', '2026-11-08', '2026-11-09'];
  // Thứ Hai 09/11 lúc 18h VN: chưa tới 19h → chỉ nhắc ngày cũ chưa nộp + tuần trước
  const at = (iso: string, done: string[] = []) => remindersAt(iso, shift, new Set(done)).map(x => `${x.kind}:${x.period}:${x.overdue ? 'quá hạn' : 'sắp hạn'}`);
  assert.deepEqual(at('2026-11-09T11:00:00Z', ['daily:2026-11-02']), ['daily:2026-11-05:quá hạn', 'daily:2026-11-08:quá hạn', 'weekly:2026-11-02:quá hạn']);
  assert.deepEqual(at('2026-11-09T00:30:00Z', ['daily:2026-11-02', 'daily:2026-11-05', 'daily:2026-11-08']), [], '07h30 thứ Hai: chưa nhắc tuần');
  assert.deepEqual(at('2026-11-09T01:30:00Z', ['daily:2026-11-02', 'daily:2026-11-05', 'daily:2026-11-08']), ['weekly:2026-11-02:sắp hạn']);
  assert.deepEqual(at('2026-11-09T12:30:00Z', ['daily:2026-11-02', 'daily:2026-11-05', 'daily:2026-11-08', 'weekly:2026-11-02']), ['daily:2026-11-09:sắp hạn'], '19h30');
  assert.deepEqual(at('2026-11-09T15:30:00Z', ['daily:2026-11-02', 'daily:2026-11-05', 'daily:2026-11-08', 'weekly:2026-11-02']), ['daily:2026-11-09:quá hạn'], '22h30');
  // Ngày cuối tháng 08h → tháng + kiểm kho; đầu tháng sau còn thiếu → nhắc
  assert.deepEqual(remindersAt('2026-11-30T01:30:00Z', ['2026-11-20'], new Set()).map(x => x.kind + ':' + x.period), ['monthly:2026-11', 'stocktake:2026-11']);
  assert.deepEqual(remindersAt('2026-12-03T01:30:00Z', ['2026-11-20'], new Set(['monthly:2026-11'])).map(x => x.kind + ':' + x.period), ['stocktake:2026-11']);
  assert.deepEqual(remindersAt('2026-12-15T01:30:00Z', ['2026-11-20'], new Set()), [], 'quá 10 ngày đầu tháng thì thôi nhắc tháng trước');
  assert.deepEqual(remindersAt('2026-12-03T01:30:00Z', [], new Set()), [], 'tháng không mở ca: không nhắc');
});

test('trước ngày triển khai (06/11/2026): kỳ có hạn trước đó mà chưa nộp → miễn, tính hoàn thành, không nhắc', () => {
  const now = new Date('2026-11-20T03:00:00Z').toISOString();
  assert.equal(slotStateAtLaunch('daily', '2026-11-05', null, now).state, 'exempt');
  assert.equal(slotStateAtLaunch('daily', '2026-11-06', null, now).state, 'missing', 'từ ngày 06 xét bình thường');
  assert.equal(slotStateAtLaunch('weekly', '2026-10-26', null, now).state, 'exempt', 'tuần 26/10 hạn 02/11 – trước triển khai');
  assert.equal(slotStateAtLaunch('weekly', '2026-11-02', null, now).state, 'missing', 'tuần 02/11 hạn 09/11 – sau triển khai');
  assert.equal(slotStateAtLaunch('daily', '2026-11-05', new Date('2026-11-07T01:00:00Z').toISOString(), now).state, 'late', 'đã nộp thì xét theo giờ nộp');
  const r = responsibilityAtLaunch({ month: '2026-11', now, dailyDays: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], weeks: ['2026-10-26'], reports: [] });
  assert.equal(r.parts.find(p => p.slot === 'daily')!.amount, 250_000); assert.equal(r.parts.find(p => p.slot === 'weekly')!.amount, 250_000);
  assert.equal(responsibilityAtLaunch({ month: '2026-10', now, dailyDays: ['2026-10-30'], weeks: [], reports: [] }).total, 1_000_000, 'tháng 10 (hạn 02/11) miễn cả tháng / kiểm tồn');
  assert.deepEqual(remindersAtLaunch(new Date('2026-11-06T13:00:00Z').toISOString(), ['2026-11-01', '2026-11-05', '2026-11-06'], new Set()).map(x => x.period), ['2026-11-06']);
});
