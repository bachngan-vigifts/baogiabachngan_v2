import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { storeReportDrafts, storeReportVersions, storeReports } from '../../src/modules/store/schema.ts';
import { posShifts, posRegisters } from '../../src/modules/sales/pos-schema.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
import { cashDue, canSubmitOfficial, periodEndsAt, vnClock } from '../../src/modules/store/domain/reports.ts';

/** Báo cáo CHT – nháp / nộp chính thức / lịch sử, báo cáo ngày theo sổ quỹ (tiền phải nộp), ca mở, trả / đổi / hoàn. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const at = (vnLocal: string) => new Date(vnLocal + '+07:00');
async function store(opts: { configure?: boolean } = {}) {
  const f = await setup();
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' }));
  if (opts.configure) ok(await f.call('/store/settings', f.mgr, 'PUT', { registerId: f.registerId, cashFloat: 500_000, depositSchedule: 'daily' }));
  const day = vnClock(new Date().toISOString()).day;
  const draftOf = async (kind = 'daily', period = day, cookie = f.emp) => ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=${kind}&period=${period}`, cookie));
  const submit = (inputs: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: day, clientKey: crypto.randomUUID(), inputs, ...extra });
  return { ...f, day, draftOf, submit };
}

test('domain: kỳ kết thúc theo giờ Việt Nam; tiền phải nộp không coi thiếu cấu hình là 0', () => {
  assert.equal(periodEndsAt('weekly', '2026-11-02'), at('2026-11-09T00:00:00').toISOString());
  assert.equal(canSubmitOfficial('weekly', '2026-11-02', at('2026-11-08T23:59:59').toISOString()), false, 'Chủ nhật 23:59 VN: tuần chưa kết thúc');
  assert.equal(canSubmitOfficial('weekly', '2026-11-02', at('2026-11-09T00:00:00').toISOString()), true);
  assert.equal(canSubmitOfficial('monthly', '2026-11', at('2026-11-30T23:59:00').toISOString()), false);
  assert.equal(canSubmitOfficial('monthly', '2026-11', at('2026-12-01T00:00:00').toISOString()), true);
  assert.equal(canSubmitOfficial('daily', '2026-11-06', at('2026-11-06T00:00:00').toISOString()), true, 'báo cáo ngày nộp trong ngày (hạn 22h)');
  const base = { opening: 500_000, cashIn: 300_000, spent: 50_000, depositedBook: 0, declared: null };
  const missing = cashDue({ ...base, retained: null, schedule: null });
  assert.equal(missing.due, null); assert.deepEqual(missing.missing, ['retained', 'schedule']);
  assert.deepEqual(cashDue({ ...base, opening: null, retained: 0, schedule: 'daily' }).missing, ['opening']);
  const full = cashDue({ ...base, retained: 500_000, schedule: 'daily', declared: 250_000 });
  assert.equal(full.due, 250_000); assert.equal(full.declaredDiff, 0); assert.equal(full.bookDiff, 250_000, 'khai đã nộp nhưng sổ quỹ chưa có phiếu Nộp két');
  assert.equal(full.needsExplanation, true);
  const booked = cashDue({ ...base, retained: 500_000, schedule: 'daily', declared: 250_000, depositedBook: 250_000 });
  assert.equal(booked.due, 250_000, 'phiếu Nộp két không bị trừ lần hai'); assert.equal(booked.needsExplanation, false);
  assert.equal(cashDue({ ...base, retained: 900_000, schedule: 'daily' }).due, 0, 'quỹ giữ lại lớn hơn tiền có: không âm');
});

test('nháp không phải đã nộp; nộp chính thức giữ giờ đầu, lưu lịch sử; số liệu client gửi bị bỏ qua; đã duyệt thì khoá', async () => {
  const f = await store({ configure: true });
  const shift = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  ok(await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 694_400 }));
  // Nháp: chỉ CHT cửa hàng, không tạo báo cáo, vẫn còn thiếu trong Tiền Trách nhiệm.
  assert.equal((await f.call('/store/reports/draft', f.other, 'PUT', { registerId: f.registerId, kind: 'daily', period: f.day, inputs: {} })).status, 403);
  ok(await f.call('/store/reports/draft', f.emp, 'PUT', { registerId: f.registerId, kind: 'daily', period: f.day, inputs: { incidents: 'Đang viết' } }));
  assert.equal((await f.db.select().from(storeReports)).length, 0, 'nháp không ghi báo cáo');
  const d = await f.draftOf();
  assert.equal(d.draft.inputs.incidents, 'Đang viết'); assert.equal(d.report, null); assert.equal(d.canSubmit, true);
  const list = ok(await f.call(`/store/reports?registerId=${f.registerId}&month=${f.day.slice(0, 7)}`, f.emp));
  assert.equal(list.reports.length, 0); assert.equal(list.drafts.length, 1);
  // Chính thức: thiếu số nộp ngân hàng (lịch nộp hằng ngày) → 400; số liệu "facts" client gửi bị bỏ qua.
  assert.equal((await f.submit({ incidents: 'x' })).status, 400);
  const first = ok(await f.submit({ bankDeposit: 194_400, cashExplanation: 'Đã nộp ngân hàng, chưa lập phiếu Nộp két' }, { facts: { totals: { revenue: 999_999_999 } } }), 201);
  assert.equal(first.version, 1);
  const [saved] = await f.db.select().from(storeReports);
  const data = JSON.parse(saved!.data);
  assert.equal(data.facts.totals.revenue, 194_400, 'số liệu CRM tính ở máy chủ');
  assert.ok(data.meta.factsAt && data.meta.sources.includes('cash_entries'));
  assert.equal((await f.db.select().from(storeReportDrafts)).length, 0, 'nộp chính thức xoá nháp');
  // Nộp lại: giữ giờ nộp đầu, thêm phiên bản, phiên bản 1 không đổi.
  await new Promise(r => setTimeout(r, 5));
  const again = ok(await f.submit({ bankDeposit: 194_400, cashExplanation: 'Bổ sung: nộp tại quầy VCB', incidents: 'Bể 1 ly' }));
  assert.equal(again.version, 2);
  const [after] = await f.db.select().from(storeReports);
  assert.equal(after!.submittedAt, saved!.submittedAt);
  const versions = await f.db.select().from(storeReportVersions).where(eq(storeReportVersions.reportId, saved!.id));
  assert.deepEqual(versions.map(v => v.version).sort(), [1, 2]);
  assert.equal(JSON.parse(versions.find(v => v.version === 1)!.data).inputs.incidents, '', 'lịch sử giữ bản cũ');
  assert.equal((await f.draftOf()).versions.length, 2);
  // Đã duyệt: khoá cả nộp lại lẫn nháp.
  ok(await f.call(`/store/reports/${saved!.id}/review`, f.mgr, 'POST', { review: 'ok' }));
  assert.equal((await f.submit({ bankDeposit: 1, cashExplanation: 'sửa' })).status, 409);
  assert.equal((await f.call('/store/reports/draft', f.emp, 'PUT', { registerId: f.registerId, kind: 'daily', period: f.day, inputs: {} })).status, 409);
  const locked = await f.draftOf();
  assert.equal(locked.canEdit, false); assert.equal(locked.canSubmit, false);
  assert.equal(JSON.parse((await f.db.select().from(storeReports))[0]!.data).inputs.incidents, 'Bể 1 ly', 'không sửa ngược báo cáo đã duyệt');
});

test('mốc hạn 22h giờ Việt Nam; tuần chỉ nộp chính thức từ 00h thứ Hai tuần sau', async t => {
  const f = await store({ configure: true });
  const shift = await f.open();
  // Ca mở trong một ngày cố định: đặt lại ngày làm việc để mốc thời gian không phụ thuộc ngày chạy test.
  await f.db.update(posShifts).set({ businessDate: '2026-11-04' }).where(eq(posShifts.id, shift.id));
  ok(await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 500_000 }));
  const body = (key: string) => ({ registerId: f.registerId, kind: 'daily', period: '2026-11-04', clientKey: key, inputs: { bankDeposit: 0 } });
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-11-04T21:59:00') });
  assert.equal(ok(await f.call('/store/reports', f.emp, 'POST', body('daily-key-0001')), 201).state.state, 'on_time');
  t.mock.timers.setTime(at('2026-11-04T22:01:00').getTime());
  const late = ok(await f.call('/store/reports', f.emp, 'POST', body('daily-key-0002')));
  assert.equal(late.state.state, 'on_time', 'nộp lại sau hạn không đổi trạng thái nộp lần đầu');
  // Tuần 02/11–08/11.
  const week = { registerId: f.registerId, kind: 'weekly', period: '2026-11-02', inputs: { orderProposal: 'Đặt 20 ly' } };
  t.mock.timers.setTime(at('2026-11-08T23:59:00').getTime());
  ok(await f.call('/store/reports/draft', f.emp, 'PUT', week));
  const blocked = await f.call('/store/reports', f.emp, 'POST', { ...week, clientKey: 'week-key-0001' });
  assert.equal(blocked.status, 409); assert.equal(blocked.data.code, 'STORE_PERIOD_OPEN');
  const draft = ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=weekly&period=2026-11-02`, f.emp));
  assert.equal(draft.canSubmit, false); assert.match(draft.blockers.join(' '), /chỉ lưu nháp/);
  t.mock.timers.setTime(at('2026-11-09T00:00:00').getTime());
  assert.equal(ok(await f.call('/store/reports', f.emp, 'POST', { ...week, clientKey: 'week-key-0002' }), 201).state.state, 'on_time');
  t.mock.timers.setTime(at('2026-11-09T10:01:00').getTime());
  // Báo cáo tuần trước khác: nộp sau 10h thứ Hai → trễ.
  const prev = { registerId: f.registerId, kind: 'weekly', period: '2026-10-26', inputs: { orderProposal: 'Đặt 5 nồi' }, clientKey: 'week-key-0003' };
  assert.equal(ok(await f.call('/store/reports', f.emp, 'POST', prev), 201).state.state, 'late');
});

test('báo cáo ngày: ca còn mở là tạm tính; tiền phải nộp từ sổ quỹ, bàn giao ca không cộng trùng, thiếu cấu hình thì báo thiếu căn cứ', async () => {
  const f = await store();
  const s1 = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(s1.id, { confirmed: true })), 201);
  const entry = (kind: string, amount: number) => ({ key: crypto.randomUUID(), kind, amount, reason: 'Phiếu kiểm thử' });
  ok(await f.call('/cash/entries', f.emp, 'POST', entry('petty_expense', 50_000)), 201);
  // Chưa cấu hình: không tính tiền phải nộp, nêu thiếu căn cứ.
  let d = await f.draftOf();
  assert.equal(d.facts.openShifts, 1); assert.equal(d.provisional, true);
  assert.equal(d.facts.cash.due, null); assert.equal(d.facts.cash.missingLabels.length, 2);
  // Ca 1 kết, bàn giao 644.400 cho ca 2 (người khác) – tiền đầu ngày vẫn là đầu ca 1.
  ok(await f.call('/pos/shifts/' + s1.id + '/close', f.emp, 'POST', { countedCash: 644_400 }));
  const s2 = await f.open(f.other);
  ok(await f.call('/pos/checkout', f.other, 'POST', f.cart(s2.id, { confirmed: true })), 201);
  ok(await f.call('/cash/entries', f.other, 'POST', entry('cash_out', 300_000)), 201);
  ok(await f.call('/store/settings', f.mgr, 'PUT', { registerId: f.registerId, cashFloat: 500_000, depositSchedule: 'daily' }));
  assert.equal((await f.call('/store/settings', f.emp, 'PUT', { registerId: f.registerId, cashFloat: 0 })).status, 403, 'chỉ Manager cấu hình');
  d = await f.draftOf();
  const c = d.facts.cash;
  assert.equal(c.opening, 500_000, 'không cộng tiền bàn giao ca 2');
  assert.equal(c.cashSales, 388_800); assert.equal(c.spent, 50_000); assert.equal(c.depositedBook, 300_000);
  assert.equal(c.due, 500_000 + 388_800 - 50_000 - 500_000, 'phiếu Nộp két không bị trừ thêm');
  assert.equal(d.facts.openShifts, 1, 'ca 2 còn mở');
  // Nộp chính thức khi còn ca mở: được nộp nhưng đánh dấu tạm tính.
  const declared = c.due;
  assert.equal((await f.submit({ bankDeposit: declared })).status, 400, 'khai khác sổ quỹ (Nộp két 300.000) → phải giải trình');
  const made = ok(await f.submit({ bankDeposit: 300_000, cashExplanation: 'Nộp 300.000, giữ lại phần còn lại do ngân hàng đóng cửa' }), 201);
  assert.equal(made.provisional, true);
  const list = ok(await f.call(`/store/reports?registerId=${f.registerId}&month=${f.day.slice(0, 7)}`, f.mgr));
  assert.equal(list.reports[0].provisional, true);
  // Không tự đánh dấu sai sổ quỹ: chờ người duyệt.
  assert.equal(list.reports[0].review, 'pending');
  // Ca của ngày khác (ca qua đêm hôm trước) không lẫn vào.
  const [other] = await f.db.select().from(posShifts).where(eq(posShifts.id, s2.id));
  await f.db.insert(posShifts).values({ ...other!, id: 'yesterday-shift', businessDate: '2000-01-01', openKey: 'yesterday-open-key', previousShiftId: null, closedAt: other!.openedAt, countedCash: 0, expectedCash: 0, cashDifference: 0, reportSnapshot: '{}' });
  assert.equal((await f.draftOf()).facts.shifts.length, 2);
});

test('trả / đổi / hoàn: liệt kê chứng từ, tiền hoàn chỉ trừ một lần, đơn huỷ không tính doanh thu', async () => {
  const f = await store({ configure: true });
  const shift = await f.open();
  const sale = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  const lines = await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, sale.id));
  const req = ok(await f.call('/pos/returns', f.emp, 'POST', { key: crypto.randomUUID(), orderId: sale.id, shiftId: shift.id, reason: 'Khách trả 1 ly',
    lines: [{ orderLineId: lines[0]!.id, qty: 1 }] }), 201);
  ok(await f.call('/pos/returns/' + req.id + '/approve', f.mgr, 'POST', {}));
  ok(await f.call('/pos/returns/' + req.id + '/receive', f.emp, 'POST', { shiftId: shift.id, confirmed: true }));
  const refund = ok(await f.call('/pos/returns/' + req.id + '/refund', f.emp, 'POST', { key: crypto.randomUUID(), shiftId: shift.id, confirmed: true, amount: 97_200, method: 'cash' }), 201);
  ok(await f.call('/pos/returns/' + req.id + '/complete', f.emp, 'POST', {}));
  // Một đơn huỷ trong ca: không tính doanh thu.
  const cancelled = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  await f.db.update(salesOrders).set({ status: 'cancelled' }).where(eq(salesOrders.id, cancelled.id));
  const d = await f.draftOf();
  assert.equal(d.facts.totals.bills, 1); assert.equal(d.facts.totals.revenue, 194_400);
  assert.equal(d.facts.returns.length, 1); assert.equal(d.facts.returns[0].orderNo, sale.orderNo); assert.equal(d.facts.returns[0].status, 'completed');
  assert.equal(d.facts.totals.returnsValue, 97_200);
  assert.equal(d.facts.refunds.length, 1); assert.equal(d.facts.refunds[0].amount, 97_200); assert.ok(d.facts.refunds[0].cashEntryId, 'liên kết phiếu chi Sổ quỹ');
  assert.equal(d.facts.cash.refundsCash, 97_200); assert.equal(d.facts.cash.spent, 97_200, 'hoàn tiền mặt trừ đúng một lần (qua phiếu chi)');
  assert.ok(refund);
});

test('phạm vi: CHT không xem / lưu / nộp cửa hàng khác; người duyệt xem được; cấu hình xem theo quyền cửa hàng', async () => {
  const f = await store({ configure: true });
  const [reg] = await f.db.select().from(posRegisters).where(eq(posRegisters.id, f.registerId));
  await f.db.insert(posRegisters).values({ ...reg!, id: 'other-store', name: 'Cửa hàng khác' });
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: 'other-store', memberId: 'cashier2' }));
  assert.equal((await f.call(`/store/reports/draft?registerId=other-store&kind=daily&period=${f.day}`, f.emp)).status, 403);
  assert.equal((await f.call('/store/reports/draft', f.emp, 'PUT', { registerId: 'other-store', kind: 'daily', period: f.day, inputs: {} })).status, 403);
  assert.equal((await f.call('/store/reports', f.emp, 'POST', { registerId: 'other-store', kind: 'daily', period: f.day, clientKey: crypto.randomUUID(), inputs: {} })).status, 403);
  assert.equal((await f.call('/store/settings?registerId=other-store', f.emp)).status, 403);
  assert.equal((await f.call(`/store/reports?registerId=other-store`, f.emp)).status, 403);
  assert.equal(ok(await f.call(`/store/reports/draft?registerId=other-store&kind=daily&period=${f.day}`, f.mgr)).canEdit, false, 'người duyệt chỉ xem');
  const mine = ok(await f.call(`/store/settings?registerId=${f.registerId}`, f.emp));
  assert.equal(mine.settings.cashFloat, 500_000); assert.equal(mine.canEdit, false);
  assert.equal((await f.call('/store/settings', f.mgr, 'PUT', { registerId: f.registerId, depositSchedule: 'hourly' })).status, 400);
});
