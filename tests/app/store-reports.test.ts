import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { storeReports } from '../../src/modules/store/schema.ts';
import { deadlineOf, vnClock } from '../../src/modules/store/domain/reports.ts';

/** Báo cáo Cửa hàng trưởng: gán CHT, nộp (tự điền từ ca POS), chống lặp, quyền, duyệt, Tiền Trách nhiệm, nhắc nhở. */
async function store() {
  const f = await setup();
  assert.equal((await f.call('/store/managers', f.emp, 'PUT', { registerId: f.registerId, memberId: 'emp' })).status, 403, 'nhân viên không tự gán');
  assert.equal((await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' })).status, 200);
  const shift = await f.open();
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true }))).status, 201);
  assert.equal((await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 694_400 })).status, 200);
  return { ...f, day: vnClock(new Date().toISOString()).day };
}

test('CHT nộp báo cáo ngày: số liệu ca POS tự điền, giữ giờ nộp lần đầu, chống lặp, người khác không xem / nộp được', async t => {
  const f = await store();
  const status = (await f.call('/store/status', f.emp)).data;
  assert.equal(status.mine.registerId, f.registerId); assert.equal(status.canReview, false);
  const draft = (await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=daily&period=${f.day}`, f.emp)).data;
  assert.equal(draft.facts.totals.bills, 1); assert.equal(draft.facts.totals.revenue, 194_400); assert.equal(draft.facts.totals.cash, 194_400); assert.equal(draft.report, null);
  // Hộp nhắc lúc 20h30 cùng ngày: có báo cáo ngày hôm nay
  t.mock.timers.enable({ apis: ['Date'], now: new Date(f.day + 'T13:30:00Z') });
  const due = (await f.call('/store/reminders', f.emp)).data.items.filter((x: any) => x.kind === 'daily');
  assert.deepEqual(due.map((x: any) => [x.period, x.overdue]), [[f.day, false]]);
  t.mock.timers.reset();
  const body = (key: string, extra = {}) => ({ registerId: f.registerId, kind: 'daily', period: f.day, clientKey: key, inputs: { bankDeposit: '194.400', cashExplanation: 'Nộp ngân hàng, chưa lập phiếu Nộp két', incidents: 'Không có', ...extra } });
  const first = await f.call('/store/reports', f.emp, 'POST', body('key-first-0001'));
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.state.state, new Date().toISOString() <= deadlineOf('daily', f.day) ? 'on_time' : 'late');
  assert.equal((await f.call('/store/reports', f.emp, 'POST', body('key-first-0001'))).data.replayed, true);
  const [saved] = await f.db.select().from(storeReports);
  assert.equal(JSON.parse(saved!.data).inputs.bankDeposit, 194_400); assert.equal(JSON.parse(saved!.data).facts.totals.revenue, 194_400);
  const again = await f.call('/store/reports', f.emp, 'POST', body('key-second-0002', { incidents: 'Bể 1 ly' }));
  assert.equal(again.data.updated, true);
  const [updated] = await f.db.select().from(storeReports);
  assert.equal(updated!.submittedAt, saved!.submittedAt, 'nộp lại không đổi giờ nộp lần đầu'); assert.equal(JSON.parse(updated!.data).inputs.incidents, 'Bể 1 ly');
  assert.equal((await f.db.select().from(storeReports)).length, 1);
  // Người không phải CHT
  assert.equal((await f.call('/store/reports', f.other, 'POST', body('key-other-0003'))).status, 403);
  assert.equal((await f.call(`/store/reports?registerId=${f.registerId}`, f.other)).status, 403);
  assert.equal((await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=daily&period=${f.day}`, f.other)).status, 403);
  // Sau khi nộp: hết nhắc báo cáo ngày hôm nay
  t.mock.timers.enable({ apis: ['Date'], now: new Date(f.day + 'T13:30:00Z') });
  assert.equal((await f.call('/store/reminders', f.emp)).data.items.filter((x: any) => x.kind === 'daily').length, 0);
  t.mock.timers.reset();
  assert.deepEqual((await f.call('/store/reminders', f.other)).data.items, [], 'không phải CHT: không nhắc');
});

test('kiểm tra đầu vào: kỳ sai / chưa tới / chưa kết thúc, thiếu nội dung bắt buộc, thiếu mã chống lặp', async t => {
  const f = await store();
  const post = (b: Record<string, unknown>) => f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, clientKey: crypto.randomUUID(), ...b });
  const monday = (await import('../../src/modules/store/domain/reports.ts')).mondayOf(f.day);
  const prevMonth = (await import('../../src/modules/store/domain/reports.ts')).prevMonth(f.day.slice(0, 7));
  const open = await post({ kind: 'weekly', period: monday, inputs: { orderProposal: 'Đặt thêm ly' } });
  assert.equal(open.status, 409, 'tuần chưa kết thúc: chỉ lưu nháp'); assert.equal(open.data.code, 'STORE_PERIOD_OPEN');
  assert.equal((await post({ kind: 'monthly', period: f.day.slice(0, 7), inputs: { staffReview: 'Tốt' } })).status, 409, 'tháng chưa kết thúc');
  assert.equal((await post({ kind: 'weekly', period: '2026-11-03', inputs: { orderProposal: 'Đặt thêm ly' } })).status, 400, 'kỳ tuần phải là thứ Hai');
  assert.equal((await post({ kind: 'daily', period: '2099-01-01', inputs: {} })).status, 400, 'kỳ chưa tới');
  assert.equal((await post({ kind: 'monthly', period: prevMonth, inputs: { staffReview: '' } })).status, 400);
  assert.equal((await post({ kind: 'stocktake', period: prevMonth, inputs: { counted: false } })).status, 400);
  assert.equal((await post({ kind: 'daily', period: f.day, inputs: { bankDeposit: '-5' } })).status, 400);
  assert.equal((await f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: f.day, inputs: {} })).status, 400, 'thiếu clientKey');
  // Sang thứ Hai tuần sau: tuần đã kết thúc → nộp chính thức được (thiếu đề xuất đặt hàng vẫn 400).
  t.mock.timers.enable({ apis: ['Date'], now: new Date(Date.parse(monday + 'T00:00:00+07:00') + 7 * 86400_000 + 3600_000) });
  assert.equal((await post({ kind: 'weekly', period: monday, inputs: {} })).status, 400, 'thiếu đề xuất đặt hàng');
  const weekly = await post({ kind: 'weekly', period: monday, inputs: { orderProposal: 'Đặt thêm 20 ly sứ', roster: 'Ca sáng: A' } });
  assert.equal(weekly.status, 201, JSON.stringify(weekly.data));
  const draft = (await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=weekly&period=${monday}`, f.emp)).data;
  assert.equal(draft.facts.revenue, 194_400); assert.equal(draft.facts.top[0].sku, '00123'); assert.equal(draft.report.data.inputs.orderProposal, 'Đặt thêm 20 ly sứ');
});

test('duyệt: chỉ người có quyền, kết quả đúng loại, bắt buộc lý do; đã duyệt thì khoá; CHT giải trình; Tiền Trách nhiệm theo duyệt', async () => {
  const f = await store();
  const made = await f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: f.day, clientKey: crypto.randomUUID(), inputs: { bankDeposit: 194400, cashExplanation: 'Nộp ngân hàng trực tiếp' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id;
  assert.equal((await f.call(`/store/reports/${id}/review`, f.emp, 'POST', { review: 'ok' })).status, 403);
  assert.equal((await f.call(`/store/reports/${id}/review`, f.mgr, 'POST', { review: 'order_error', note: 'sai' })).status, 400, 'đề xuất sai chỉ cho báo cáo tuần');
  assert.equal((await f.call(`/store/reports/${id}/review`, f.mgr, 'POST', { review: 'cash_error' })).status, 400, 'thiếu lý do');
  assert.equal((await f.call(`/store/reports/${id}/review`, f.mgr, 'POST', { review: 'cash_error', note: 'Lệch 50.000 so với sổ quỹ' })).status, 200);
  const month = (await f.call(`/store/reports?registerId=${f.registerId}&month=${f.day.slice(0, 7)}`, f.mgr)).data;
  assert.equal(month.reports.length, 1); assert.equal(month.reports[0].review, 'cash_error'); assert.deepEqual(month.dailyDays, [f.day]);
  const daily = month.responsibility.parts.find((p: any) => p.slot === 'daily');
  assert.equal(daily.fails, 2); assert.equal(daily.amount, 150_000, 'sai sổ quỹ tính 2 lần → 150.000');
  assert.equal((await f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: f.day, clientKey: crypto.randomUUID(), inputs: {} })).status, 409, 'đã duyệt: khoá');
  assert.equal((await f.call(`/store/reports/${id}/explain`, f.other, 'POST', { explanation: 'xx yy' })).status, 403);
  assert.equal((await f.call(`/store/reports/${id}/explain`, f.emp, 'POST', { explanation: 'Khách chuyển khoản trễ, đã bổ sung' })).status, 200);
  assert.equal((await f.call(`/store/reports/${id}/review`, f.mgr, 'POST', { review: 'excused', note: 'Lỗi ngân hàng, đã xác minh' })).status, 200);
  const after = (await f.call(`/store/reports?registerId=${f.registerId}&month=${f.day.slice(0, 7)}`, f.emp)).data;
  assert.equal(after.responsibility.parts[0].amount, 250_000); assert.equal(after.reports[0].explanation, 'Khách chuyển khoản trễ, đã bổ sung');
  // Gán CHT khác cho cửa hàng: CHT cũ mất quyền nộp
  assert.equal((await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'cashier2' })).status, 200);
  assert.equal((await f.call('/store/status', f.emp)).data.mine, null);
  assert.equal((await f.db.select().from(storeReports).where(eq(storeReports.id, id))).length, 1, 'báo cáo cũ giữ nguyên');
  const status = (await f.call('/store/status', f.mgr)).data;
  assert.equal(status.canReview, true); assert.equal(status.stores.find((s: any) => s.registerId === f.registerId).memberId, 'cashier2');
});
