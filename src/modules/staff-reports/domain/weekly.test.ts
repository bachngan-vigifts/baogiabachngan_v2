import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthPoints, weekScore, weeklyDeadline, weeklyResponsibility, weeksOfMonth, canSubmitWeek, isWeek } from './weekly.ts';

const at = (s: string) => new Date(s + '+07:00').toISOString();
test('tuần thuộc tháng theo ngày hạn nộp (thứ Hai tuần sau); tháng có 5 tuần', () => {
  assert.deepEqual(weeksOfMonth('2026-12'), ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  assert.deepEqual(weeksOfMonth('2027-03'), ['2027-02-22', '2027-03-01', '2027-03-08', '2027-03-15', '2027-03-22']);
  assert.equal(weeklyDeadline('2026-12-07'), at('2026-12-14T10:00:00'));
  assert.equal(canSubmitWeek('2026-12-07', at('2026-12-13T23:59:00')), false);
  assert.equal(canSubmitWeek('2026-12-07', at('2026-12-14T00:00:00')), true);
  assert.equal(isWeek('2026-12-08'), false); assert.equal(isWeek('2026-12-07'), true);
});
test('điểm tuần: đúng hạn 1, trễ < 1 ngày 0,5, trễ từ 1 ngày / không nộp 0; Chưa đạt 0; Miễn 1', () => {
  const now = at('2027-01-10T00:00:00');
  assert.equal(weekScore('2026-12-07', { submittedAt: at('2026-12-14T09:59:00'), review: 'pending' }, now), 1);
  assert.equal(weekScore('2026-12-07', { submittedAt: at('2026-12-15T09:59:00'), review: 'ok' }, now), 0.5);
  assert.equal(weekScore('2026-12-07', { submittedAt: at('2026-12-15T10:00:00'), review: 'ok' }, now), 0);
  assert.equal(weekScore('2026-12-07', null, now), 0);
  assert.equal(weekScore('2026-12-07', { submittedAt: at('2026-12-13T09:00:00'), review: 'rejected' }, now), 0);
  assert.equal(weekScore('2026-12-07', null, at('2026-12-14T09:00:00')), null, 'chưa tới hạn');
  assert.equal(weekScore('2026-12-07', { submittedAt: at('2026-12-20T09:00:00'), review: 'excused' }, now), 1);
});
test('tháng 5 tuần lấy 4 tuần điểm cao nhất; công thức Tiền trách nhiệm', () => {
  const now = at('2027-04-10T00:00:00'), ok = (d: string) => ({ submittedAt: at(d + 'T08:00:00'), review: 'ok' as const });
  const r = new Map([['2027-02-22', ok('2027-03-01')], ['2027-03-01', ok('2027-03-08')], ['2027-03-08', ok('2027-03-15')], ['2027-03-22', ok('2027-03-29')]]);
  const m = monthPoints('2027-03', r, now);
  assert.equal(m.weeks.length, 5); assert.equal(m.points, 4, 'bỏ tuần không nộp vì chỉ cần 4');
  assert.equal(Math.round(weeklyResponsibility(1_000_000, 24, 26, 3.5)), 807_692);
  assert.equal(weeklyResponsibility(1_000_000, 26, 26, 5), 1_000_000, 'tối đa 4 điểm');
});
test('nhóm ngành: ưu tiên loại khách, rồi tên khách; không khớp → Khác', async () => {
  const { industryOf, weeklyProblems } = await import('./weekly.ts');
  assert.equal(industryOf(null, 'Agribank CN Bến Tre'), 'bank');
  assert.equal(industryOf(null, 'Ngân hàng VIB chi nhánh An Giang'), 'bank');
  assert.equal(industryOf(null, 'Vib An Giang'), 'bank');
  assert.equal(industryOf(null, 'QTDND Chợ Vàm An Giang'), 'bank');
  assert.equal(industryOf(null, 'Công ty Phân bón Thế Mẫn'), 'agri');
  assert.equal(industryOf(null, 'CÔNG TY TNHH NÔNG NGHIỆP HƯNG NGUYÊN PHÁT'), 'agri');
  assert.equal(industryOf(null, 'Thuỷ sản TBC'), 'aqua');
  assert.equal(industryOf('Thủy sản', 'Công ty Khang Thịnh Phát'), 'aqua', 'loại khách thắng tên');
  assert.equal(industryOf('Nhà máy', 'Bệnh viện Tim mạch An Giang'), 'other');
  assert.deepEqual(weeklyProblems({ highlights: '', nextWeekPlan: '', support: '', quoteNotes: { a: 'Đang trình' } }, [{ id: 'a', quoteNo: 'BG-1' }, { id: 'b', quoteNo: 'BG-2' }]),
    ['Nhập kế hoạch tuần tới.', 'Ghi tình trạng / bước tiếp cho báo giá: BG-2.']);
});
test('ngày triển khai: tuần có hạn trước 06/11/2026 tính Miễn 1 điểm', async () => {
  const { weekScore, weekState, beforeLaunch } = await import('./weekly.ts');
  assert.equal(beforeLaunch('2026-10-26'), true); assert.equal(beforeLaunch('2026-11-02'), false);
  assert.equal(weekState('2026-10-26', null, at('2026-11-20T00:00:00')).state, 'exempt');
  assert.equal(weekScore('2026-10-26', null, at('2026-11-20T00:00:00')), 1);
  assert.equal(weekScore('2026-10-26', null, at('2026-11-20T00:00:00'), ''), 0, 'không miễn khi tắt mốc');
  assert.equal(weekScore('2026-11-02', null, at('2026-11-20T00:00:00')), 0);
});
test('báo cáo tháng: hạn 10h ngày 02 tháng sau; điểm cùng thang; tối đa 5 từ 11/2026', async () => {
  const { monthlyDeadline, canSubmitMonth, monthlyScore, monthPoints, nextMonth, shiftMonths } = await import('./weekly.ts');
  assert.equal(monthlyDeadline('2026-12'), at('2027-01-02T10:00:00')); assert.equal(nextMonth('2026-12'), '2027-01'); assert.equal(shiftMonths('2026-01', -1), '2025-12');
  assert.equal(canSubmitMonth('2026-11', at('2026-11-30T23:59:00')), false); assert.equal(canSubmitMonth('2026-11', at('2026-12-01T00:00:00')), true);
  assert.equal(monthlyScore('2026-11', { submittedAt: at('2026-12-02T09:00:00'), review: 'pending' }, at('2026-12-10T00:00:00')), 1);
  assert.equal(monthlyScore('2026-11', { submittedAt: at('2026-12-02T18:00:00'), review: 'ok' }, at('2026-12-10T00:00:00')), 0.5);
  assert.equal(monthlyScore('2026-11', null, at('2026-12-01T00:00:00')), null);
  assert.equal(monthPoints('2026-11', new Map(), at('2026-12-10T00:00:00')).required, 5);
  assert.equal(monthPoints('2026-10', new Map(), at('2026-12-10T00:00:00')).required, 4);
});
