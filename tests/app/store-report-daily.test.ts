import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { DAILY_DONE } from '../helpers/store-daily.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { stockTransfers, stockTransferLines } from '../../src/modules/inventory/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { compareAvg, incidentTypesOf, monthPace, vnClock } from '../../src/modules/store/domain/reports.ts';

/** Báo cáo ngày CHT bản 2: checklist cuối ngày bắt buộc, sự cố theo loại, số CRM tự điền thêm. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('domain: TB 7 ngày không có dữ liệu → null; nhịp chỉ tiêu; "Không có" sự cố đi một mình', () => {
  assert.deepEqual(compareAvg(100, []), { avg: null, pct: null, days: 0 });
  assert.deepEqual(compareAvg(120, [100, 100, 0, 200]), { avg: 100, pct: 20, days: 4 });
  assert.deepEqual(monthPace('2026-11-06', 300_000_000, 60_000_000), { elapsed: 20, daysLeft: 24, needPerDay: 10_000_000 });
  assert.equal(monthPace('2026-11-30', 300, 100).needPerDay, null, 'ngày cuối tháng: không còn ngày');
  assert.equal(monthPace('2026-11-06', 100, 500).needPerDay, 0);
  assert.deepEqual(incidentTypesOf(['none', 'damage', 'xx', 'damage']), ['damage']);
  assert.deepEqual(incidentTypesOf(['none']), ['none']);
});

test('nộp chính thức: bắt buộc trả lời đủ checklist và chọn sự cố; sự cố khác "Không có" phải mô tả; checklist không ảnh hưởng Tiền Trách nhiệm', async t => {
  // Cố định 12h00 giờ VN hôm nay: nộp trước hạn 22h dù test chạy lúc nào trong ngày.
  t.mock.timers.enable({ apis: ['Date'], now: new Date(vnClock(new Date().toISOString()).day + 'T12:00:00+07:00') });
  const f = await setup();
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' }));
  const day = vnClock(new Date().toISOString()).day, shift = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  ok(await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 694_400 }));
  const post = (inputs: Record<string, unknown>) => f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: day, clientKey: crypto.randomUUID(), inputs: { bankDeposit: 0, ...inputs } });
  const noList = await post({ incidentTypes: ['none'] });
  assert.equal(noList.status, 400); assert.match(noList.data.error, /checklist/);
  const half = await post({ ...DAILY_DONE, checklist: { clean: 'yes', display: 'no' } });
  assert.match(half.data.error, /còn 3 mục/);
  assert.match((await post({ ...DAILY_DONE, incidentTypes: [] })).data.error, /sự cố/);
  assert.match((await post({ ...DAILY_DONE, incidentTypes: ['damage'] })).data.error, /Mô tả sự cố/);
  // "Chưa" vẫn là câu trả lời hợp lệ; không trừ tiền.
  const made = ok(await post({ ...DAILY_DONE, checklist: { ...DAILY_DONE.checklist, valuable: 'no' }, incidentTypes: ['damage', 'none'], incidents: 'Bể 1 ly khi xếp kệ', officeSupport: 'Gửi thêm hộp quà', tomorrowPlan: 'Kiểm kho' }), 201);
  const d = ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=daily&period=${day}`, f.emp));
  assert.deepEqual(d.report.data.inputs.incidentTypes, ['damage']); assert.equal(d.report.data.inputs.checklist.valuable, 'no');
  assert.equal(d.checklistItems.length, 5); assert.equal(d.incidentTypes.none, 'Không có');
  const month = ok(await f.call(`/store/reports?registerId=${f.registerId}&month=${day.slice(0, 7)}`, f.emp));
  assert.equal(month.responsibility.parts.find((p: any) => p.slot === 'daily').fails, 0, 'checklist "chưa" không tính chưa đạt');
  assert.ok(made.id);
});

test('số CRM tự điền: TB / hoá đơn, khách mới, TB 7 ngày (chỉ ngày có ca), top bán chạy, chỉ tiêu chưa cấu hình, hàng nhận trong ngày', async () => {
  const f = await setup();
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' }));
  const day = vnClock(new Date().toISOString()).day, shift = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true })), 201);
  const draft = async () => ok(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=daily&period=${day}`, f.emp)).facts;
  let x = await draft();
  assert.equal(x.aov, 194_400); assert.equal(x.newCustomers, 1, 'cùng khách mua 2 đơn: 1 khách mới');
  assert.deepEqual(x.vsAvg7, { avg: null, pct: null, days: 0 }, 'chưa có ngày trước: không so');
  assert.equal(x.top[0].sku, '00123'); assert.equal(x.target.configured, false); assert.equal(x.lowStock.configured, false);
  // Khách đã mua từ trước → không còn là khách mới. Một ngày có ca trước đó không bán → TB tính 0 thật.
  const [o] = await f.db.select().from(salesOrders).limit(1);
  const [s] = await f.db.select().from(posShifts).where(eq(posShifts.id, shift.id));
  const prev = new Date(Date.parse(day + 'T00:00:00Z') - 2 * 86400_000).toISOString().slice(0, 10);
  await f.db.insert(posShifts).values({ ...s!, id: 'prev', businessDate: prev, openKey: 'prev-key', previousShiftId: null, closedAt: s!.openedAt, countedCash: 0, expectedCash: 0, cashDifference: 0, reportSnapshot: '{}' });
  await f.db.insert(salesOrders).values({ ...o!, id: 'old-order', orderNo: 'OLD-1', orderDate: prev, shiftId: null, channel: 'crm', checkoutKey: null, posSnapshot: null });
  // Phiếu điều chuyển đã nhận vào kho cửa hàng hôm nay.
  await f.db.insert(warehouses).values({ id: 'wh-main', name: 'Kho tổng', kind: 'stock' });
  const now = new Date().toISOString();
  await f.db.insert(stockTransfers).values({ id: 'tr1', transferNo: 'DC-9', fromWarehouseId: 'wh-main', toWarehouseId: 'pos-wh', status: 'done', requestedBy: 'mgr', doneAt: now, createdAt: now, updatedAt: now });
  await f.db.insert(stockTransferLines).values([{ id: 'l1', transferId: 'tr1', sku: '00123', qty: 2 }, { id: 'l2', transferId: 'tr1', sku: 'X', qty: 1 }]);
  x = await draft();
  assert.equal(x.newCustomers, 0);
  assert.deepEqual(x.vsAvg7, { avg: 0, pct: null, days: 1 });
  assert.deepEqual(x.received.map((r: any) => [r.transferNo, r.lines]), [['DC-9', 2]]);
});
