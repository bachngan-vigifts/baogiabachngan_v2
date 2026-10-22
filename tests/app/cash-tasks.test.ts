import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, like } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';

/**
 * VIỆC SỔ QUỸ: nhân viên nộp két / lập phiếu từ ngưỡng duyệt → vào hộp Cần duyệt + việc tự sinh ngay (không đợi mở trang Công việc);
 * kết ca lệch → việc giải trình cho nhân viên rồi việc đóng tra soát cho Manager; ca ngày trước chưa kết → việc kết ca.
 */
const byKey = async (f: Awaited<ReturnType<typeof setup>>, prefix: string) => f.db.select().from(tasks).where(like(tasks.autoKey, prefix + '%'));

test('Nộp két ≥ ngưỡng: hộp Cần duyệt đúng cửa hàng, việc duyệt sinh ngay và tự hoàn thành khi duyệt', async () => {
  const f = await setup();
  await f.open();
  const made = await f.call('/cash/entries', f.emp, 'POST', { key: crypto.randomUUID(), kind: 'cash_out', amount: 2000000, reason: 'Nộp tiền ca sáng' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.status, 'pending');
  const [t] = await byKey(f, 'cash-approve:');
  assert.ok(t, 'việc duyệt có ngay sau khi lập phiếu');
  assert.equal(t.source, 'cash'); assert.equal(t.assigneeId, null); assert.equal(t.status, 'todo');
  assert.match(t.title, /Duyệt phiếu chi .*Nộp két 2\.000\.000 đ/);
  assert.equal(t.link, `#/cash?drawerId=store&entryId=${made.data.id}`);

  const inbox = (await f.call('/approvals', f.mgr)).data;
  assert.equal(inbox.counts.cash, 1);
  assert.deepEqual(inbox.items.map((i: any) => [i.kind, i.amount, i.link]), [['cash', 2000000, t.link]]);
  assert.equal((await f.call('/approvals', f.emp)).status, 403, 'nhân viên không được duyệt không xem hộp');
  // Người được chỉ định cùng cửa hàng thấy; chính người lập (dù được chỉ định) không thấy phiếu của mình.
  await f.db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'cashier2'));
  await f.db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'emp'));
  assert.equal((await f.call('/approvals', f.other)).data.counts.cash, 1);
  assert.equal((await f.call('/approvals', f.emp)).data.counts.cash, 0);
  // Khác cửa hàng (Minh Long) không thấy két Lock.
  await f.db.update(employees).set({ positionId: 'sales-ml' }).where(eq(employees.id, 'cashier2'));
  assert.equal((await f.call('/approvals', f.other)).data.counts.cash, 0);

  assert.equal((await f.call(`/cash/entries/${made.data.id}/approve`, f.mgr, 'POST', {})).status, 200);
  const [after] = await byKey(f, 'cash-approve:');
  assert.equal(after!.status, 'done'); assert.equal(after!.completedBy, null);
  assert.equal((await f.call('/approvals', f.mgr)).data.counts.cash, 0);
});

test('Kết ca lệch tiền: việc giải trình cho nhân viên → việc đóng tra soát cho Manager → đóng thì xong', async () => {
  const f = await setup();
  const shift = await f.open();
  const closed = await f.call('/cash/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 400000, reasonCode: 'counting' });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  const [explain] = await byKey(f, 'cash-recon:');
  assert.ok(explain, 'kết ca ở Sổ quỹ cũng sinh việc ngay');
  assert.match(explain.autoKey!, /:explain$/); assert.equal(explain.assigneeId, 'emp');
  assert.match(explain.title, /Giải trình lệch két .*thiếu 100\.000 đ/);
  const recId = explain.sourceId!;
  assert.equal(explain.link, `#/cash?drawerId=store&reconciliationId=${recId}`);
  assert.equal((await f.call(`/cash/reconciliations/${recId}/explain`, f.emp, 'POST', { explanation: 'Đếm nhầm tờ 100.000' })).status, 200);
  const step2 = await byKey(f, 'cash-recon:');
  assert.equal(step2.find(t => t.autoKey!.endsWith(':explain'))!.status, 'done');
  const close = step2.find(t => t.autoKey!.endsWith(':close'))!;
  assert.equal(close.status, 'todo'); assert.equal(close.assigneeId, null);
  assert.equal((await f.call(`/cash/reconciliations/${recId}/close`, f.mgr, 'POST', { reason: 'Đã kiểm' })).status, 200);
  assert.ok((await byKey(f, 'cash-recon:')).every(t => t.status === 'done'));
});

test('Ca ngày trước chưa kết: việc kết ca cho người mở ca, kết ca thì tự hoàn thành', async () => {
  const f = await setup();
  const shift = await f.open();
  await reconcileAutoTasks(f.db);
  assert.equal((await byKey(f, 'shift-open:')).length, 0, 'ca hôm nay chưa nhắc');
  await f.db.update(posShifts).set({ businessDate: '2026-01-05' }).where(eq(posShifts.id, shift.id));
  await reconcileAutoTasks(f.db);
  const [t] = await byKey(f, 'shift-open:');
  assert.equal(t!.assigneeId, 'emp'); assert.equal(t!.priority, 'urgent'); assert.equal(t!.source, 'cash');
  assert.match(t!.title, /Kết ca quầy .* ngày 05\/01\/2026/);
  assert.equal((await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 500000 })).status, 200);
  assert.equal((await byKey(f, 'shift-open:'))[0]!.status, 'done');
});
