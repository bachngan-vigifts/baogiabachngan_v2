import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore – module giao diện thuần JS
import { BREAK_DEFAULTS as C, freshState, recordActivity, dueReminder, canSnooze, snoozed, afterFirst, afterSecond, clock } from '../../trial-ui/break-reminder.js';

const ui = join(import.meta.dirname, '../../trial-ui'), read = (f: string) => readFileSync(join(ui, f), 'utf8');
const MIN = 60_000, T0 = 1_800_000_000_000;
/** Thao tác đều mỗi `step` trong `total` phút kể từ trạng thái `s`. */
function work(s: any, from: number, totalMin: number, stepMin = 1) { let t = from; for (let m = 0; m < totalMin; m += stepMin) { t = from + m * MIN; s = recordActivity(s, t, C); } return { s, t }; }

test('ngưỡng mặc định: nghỉ 5 phút tính lại, nhắc ở 1 giờ và 2 giờ, nghỉ 2 phút, hoãn 5 phút', () => {
  assert.deepEqual(C, { idleMs: 5 * MIN, firstMs: 60 * MIN, secondMs: 120 * MIN, restMs: 2 * MIN, snoozeMs: 5 * MIN, throttleMs: 2000 });
});
test('thao tác liên tục dưới 1 giờ: chưa nhắc', () => {
  const { s, t } = work(null, T0, 59);
  assert.equal(dueReminder(s, t, C), null); assert.equal(s.start, T0);
});
test('đủ 1 giờ liên tục: nhắc mốc 1 giờ đúng một lần, đồng hồ chạy tiếp tới 2 giờ', () => {
  let { s, t } = work(null, T0, 61);
  assert.equal(dueReminder(s, t, C), 'first');
  s = afterFirst(s, t + 2 * MIN); // popup 2 phút
  assert.equal(dueReminder(s, t + 2 * MIN, C), null, 'không nhắc lại mốc 1 giờ');
  ({ s, t } = work(s, t + 2 * MIN, 58));
  assert.equal(s.start, T0, 'popup 2 phút không làm tính lại từ đầu');
  assert.equal(dueReminder(s, T0 + 120 * MIN, C), 'second');
});
test('nghỉ từ 5 phút trở lên: tính lại từ đầu; nghỉ 4 phút 59 giây: vẫn liên tục', () => {
  const { s, t } = work(null, T0, 50);
  assert.equal(recordActivity(s, t + 5 * MIN - 1000, C).start, T0);
  const reset = recordActivity(s, t + 5 * MIN, C);
  assert.equal(reset.start, t + 5 * MIN); assert.equal(reset.first, false);
  assert.equal(dueReminder(reset, t + 5 * MIN, C), null);
});
test('sau bài thở mốc 2 giờ: tính lại từ 0', () => {
  const s = afterSecond(T0 + 123 * MIN);
  assert.deepEqual(s, freshState(T0 + 123 * MIN)); assert.equal(dueReminder(s, T0 + 124 * MIN, C), null);
});
test('hoãn 5 phút: mỗi popup chỉ hoãn được 1 lần, hết 5 phút nhắc lại và không còn nút hoãn', () => {
  let { s, t } = work(null, T0, 61);
  assert.equal(canSnooze(s, 'first'), true);
  s = snoozed(s, 'first', t, C);
  assert.equal(dueReminder(s, t + 5 * MIN - 1, C), null);
  ({ s } = work(s, t, 5));
  assert.equal(dueReminder(s, t + 5 * MIN, C), 'first');
  assert.equal(canSnooze(s, 'first'), false); assert.equal(canSnooze(s, 'second'), true);
  s = snoozed(s, 'second', t, C); assert.equal(canSnooze(s, 'second'), false);
});
test('tab khác đang hiện popup (popupUntil): tab này không hiện trùng', () => {
  const { s, t } = work(null, T0, 61);
  assert.equal(dueReminder({ ...s, popupUntil: t + 8000 }, t, C), null);
  assert.equal(dueReminder({ ...s, popupUntil: t - 1 }, t, C), 'first');
});
test('dữ liệu lưu hỏng hoặc đồng hồ máy bị lùi: bắt đầu lại, không lỗi', () => {
  for (const bad of [null, undefined, {}, { start: 'x', last: 1 }, 'abc']) assert.deepEqual(recordActivity(bad as any, T0, C), freshState(T0));
  assert.deepEqual(recordActivity(freshState(T0), T0 - 10 * MIN, C), freshState(T0 - 10 * MIN));
  assert.equal(dueReminder(null as any, T0, C), null);
});
test('đồng hồ đếm ngược hiển thị phút:giây', () => {
  assert.equal(clock(120_000), '2:00'); assert.equal(clock(61_500), '1:02'); assert.equal(clock(0), '0:00'); assert.equal(clock(-5), '0:00');
});
test('tích hợp: nạp trong workspace, không gọi API, không nút đóng, Esc không tắt, POS chỉ nhắc nhẹ', () => {
  const h = read('index.html'), js = read('break-reminder.js'), css = read('break-reminder.css');
  assert.match(h, /href="break-reminder\.css"/); assert.match(h, /<script type="module" src="break-reminder\.js"><\/script>/);
  assert.doesNotMatch(js, /\/api\/|api\(/, 'không gọi API');
  assert.match(js, /addEventListener\('cancel', e => e\.preventDefault\(\)\)/);
  assert.doesNotMatch(js, /data-close|aria-label="Đóng"/, 'popup khoá không có nút đóng');
  assert.match(js, /if \(onPos\(\)\) nudge\(due\)/);
  assert.match(js, /pos-payment-modal\[open\]/, 'không cắt ngang lúc thanh toán');
  assert.match(js, /data-mode="wim"/); assert.match(js, /duration-120/);
  assert.match(css, /\.break-sen/);
  const img = join(ui, 'break-assets/madam-sen.jpg'); assert.ok(existsSync(img)); assert.ok(statSync(img).size < 200_000, 'ảnh nền nhẹ');
  assert.doesNotMatch(read('supplier.html'), /break-reminder/, 'cổng NCC không áp dụng');
  assert.match(read('dialog-layout.js'), /\.break-dialog/);
});
