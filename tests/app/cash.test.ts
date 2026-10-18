import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { cashEntries, cashDrawers, cashReconciliations } from '../../src/modules/sales/cash-schema.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
import { customerPayments, deliveries } from '../../src/modules/sales/schema.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { PASSWORD } from '../helpers/staff-fixture.ts';
import { readdirSync, readFileSync } from 'node:fs';
const entry = (kind = 'other_income', amount = 100000) => ({
  key: crypto.randomUUID(),
  kind,
  amount,
  reason: 'Phiếu kiểm thử',
});
const range = '?from=2026-01-01&to=2027-01-01';
async function account(
  f: Awaited<ReturnType<typeof setup>>,
  id: string,
  role: 'employee' | 'manager' = 'employee',
  positionId = 'accounting',
) {
  await f.db
    .insert(employees)
    .values({ id, email: id + '@x.vn', name: id, role, positionId, createdAt: new Date().toISOString() });
  await f.db.insert(credentials).values({ memberId: id, passwordHash: await hashPassword(PASSWORD, 1000), version: 0 });
  return (await f.call('/login', '', 'POST', { email: id + '@x.vn', password: PASSWORD })).cookie;
}
test('Cash: không ca không tạo, chỉ Manager cấu hình; số đầu kỳ một lần; tiền nguyên VNĐ và lý do', async () => {
  const f = await setup();
  assert.equal((await f.call('/cash/entries', f.emp, 'POST', entry())).status, 409);
  assert.equal((await f.call('/cash/config', f.emp, 'POST', { approvalThreshold: 1 })).status, 403);
  assert.equal((await f.call('/cash/config', f.mgr, 'POST', { openingAmount: 3, reason: 'Đổi' })).status, 409);
  assert.equal((await f.call('/cash', f.ncc)).status, 403);
  await f.open();
  for (const b of [
    { ...entry(), amount: 0 },
    { ...entry(), amount: 1.5 },
    { ...entry(), reason: '' },
    { ...entry(), amount: -1 },
  ])
    assert.equal((await f.call('/cash/entries', f.emp, 'POST', b)).status, 400);
  assert.equal((await f.db.select().from(cashEntries)).length, 0);
});
test('Cash: ngưỡng lấy cấu hình; chờ duyệt không vào két; kết ca bị chặn; người tạo không tự duyệt', async () => {
  const f = await setup(),
    s = await f.open();
  const made = await f.call('/cash/entries', f.emp, 'POST', entry('other_income', 1000000));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.status, 'pending');
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 500000);
  assert.equal((await f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', { countedCash: 500000 })).status, 409);
  assert.equal((await f.call('/cash/entries/' + made.data.id + '/approve', f.emp, 'POST', {})).status, 403);
  assert.equal((await f.call('/cash/entries/' + made.data.id + '/approve', f.mgr, 'POST', {})).status, 200);
  assert.equal((await f.call('/cash', f.emp)).data.balance, 1500000);
  await f.call('/cash/config', f.mgr, 'POST', { approvalThreshold: 100 });
  const own = await f.call('/cash/entries', f.mgr, 'POST', { ...entry('adjustment', 100), direction: 'in' });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  assert.equal((await f.call('/cash/entries/' + own.data.id + '/approve', f.mgr, 'POST', {})).status, 403);
  const otherManager = await account(f, 'mgr2', 'manager', 'manager');
  assert.equal((await f.call('/cash/entries/' + own.data.id + '/approve', otherManager, 'POST', {})).status, 200);
});
test('Cash: phiếu idempotent, quyền xem theo ca, Kế toán xem tất cả, ảnh private không lộ khoá', async () => {
  const f = await setup();
  await f.open();
  const b = { ...entry(), photo: 'data:image/jpeg;base64,' + Buffer.from('hoa-don').toString('base64') };
  const [a, r] = await Promise.all([
    f.call('/cash/entries', f.emp, 'POST', b),
    f.call('/cash/entries', f.emp, 'POST', b),
  ]);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.id, r.data.id);
  assert.equal(a.data.photoFileKey, undefined);
  assert.equal(f.files.files.size, 1);
  assert.equal((await f.call('/cash/entries', f.emp, 'POST', { ...b, amount: 1 })).status, 409);
  const other = (await f.call('/cash/entries' + range, f.other)).data;
  assert.equal(other.entries.length, 0);
  assert.equal((await f.call('/cash/entries/' + a.data.id + '/photo', f.other)).status, 404);
  assert.equal((await f.call('/cash/entries/' + a.data.id + '/photo', f.emp)).status, 200);
  const accountant = await account(f, 'accountant');
  assert.equal((await f.call('/cash/entries' + range, accountant)).data.entries.length, 1);
  assert.equal((await f.call('/cash/entries', f.emp, 'POST', { ...entry(), photo: ['bad'] })).status, 400);
});
test('Cash: công thức gồm tiền bán/COD và thu/chi, loại chuyển khoản/COD chưa thu/phiếu huỷ', async () => {
  const f = await setup(),
    s = await f.open();
  await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id));
  await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { method: 'transfer', confirmed: true }));
  const inc = await f.call('/cash/entries', f.emp, 'POST', entry('cash_in', 100000));
  await f.call('/cash/entries', f.emp, 'POST', entry('petty_expense', 20000));
  await f.call('/cash/entries', f.emp, 'POST', entry('cash_out', 50000));
  const voided = await f.call('/cash/entries', f.emp, 'POST', entry('other_income', 12345));
  assert.equal(
    (await f.call('/cash/entries/' + voided.data.id + '/void', f.mgr, 'POST', { reason: 'Ghi nhầm' })).status,
    200,
  );
  const cod = await f.call(
    '/pos/checkout',
    f.emp,
    'POST',
    f.cart(s.id, {
      fulfillmentMode: 'cod',
      delivery: { address: 'Test', receiverName: 'Khách', receiverPhone: '0900000000' },
    }),
  );
  assert.equal(cod.status, 201);
  const [d] = await f.db.select().from(deliveries);
  await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', { status: 'delivered' });
  const report = (await f.call('/cash/shifts/' + s.id, f.emp)).data;
  assert.equal(report.expectedCash, 724400);
  assert.equal(report.cashSales, 194400);
  assert.equal(report.transfer, 194400);
  assert.equal(report.cod.pending.amount, 194400);
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 724400);
  assert.equal((await f.call('/cash/entries/' + inc.data.id + '/void', f.emp, 'POST', { reason: 'Sai' })).status, 403);
});
test('Cash: lệch cần lý do, Khác cần ghi chú; đóng ca/tra soát một lần; ca sau lấy thực đếm, một két chỉ một ca', async () => {
  const f = await setup(),
    s = await f.open();
  assert.equal((await f.open(f.other).catch((e) => ({ blocked: true }))).blocked, true);
  assert.equal((await f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', { countedCash: 450000 })).status, 400);
  assert.equal(
    (await f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', { countedCash: 450000, reasonCode: 'other' }))
      .status,
    400,
  );
  const b = { countedCash: 450000, reasonCode: 'counting' },
    [a, r] = await Promise.all([
      f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', b),
      f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', b),
    ]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.shift.closedAt, r.data.shift.closedAt);
  assert.equal((await f.db.select().from(cashReconciliations)).length, 1);
  const next = await f.open(f.other);
  assert.equal(next.openingCash, 450000);
  assert.equal(next.previousShiftId, s.id);
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 500000, 'bàn giao không cộng thêm tiền vào sổ');
});
test('Cash: huỷ sau kết ca giữ snapshot, tự mở lại tra soát; giải trình rồi Manager đóng không sửa sổ', async () => {
  const f = await setup(),
    s = await f.open(),
    made = await f.call('/cash/entries', f.emp, 'POST', entry());
  const close = await f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', { countedCash: 600000 });
  assert.equal(close.status, 200, JSON.stringify(close.data));
  const original = (await f.db.select().from(posShifts).where(eq(posShifts.id, s.id)))[0]!.reportSnapshot;
  assert.equal((await f.call('/cash/entries/' + made.data.id + '/void', f.mgr, 'POST', {})).status, 400);
  const acct = await account(f, 'acct');
  assert.equal(
    (await f.call('/cash/entries/' + made.data.id + '/void', acct, 'POST', { reason: 'Nhập thừa' })).status,
    200,
  );
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 500000);
  assert.equal((await f.db.select().from(posShifts).where(eq(posShifts.id, s.id)))[0]!.reportSnapshot, original);
  const [rec] = await f.db.select().from(cashReconciliations);
  assert.ok(rec);
  assert.equal(rec.difference, 100000);
  assert.equal((await f.call('/navigation-counts', f.mgr)).data.cash, 1);
  assert.equal((await f.call('/navigation-counts', f.other)).data.cash, 0);
  assert.equal((await f.call('/cash/reconciliations/' + rec.id, f.other)).status, 404);
  assert.equal(
    (await f.call('/cash/reconciliations/' + rec.id + '/explain', f.other, 'POST', { explanation: 'x' })).status,
    404,
  );
  assert.equal(
    (await f.call('/cash/reconciliations/' + rec.id + '/close', f.mgr, 'POST', { reason: 'Đã kiểm tra' })).status,
    409,
  );
  assert.equal(
    (
      await f.call('/cash/reconciliations/' + rec.id + '/explain', f.emp, 'POST', {
        explanation: 'Phiếu thu nhập trùng',
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call('/cash/reconciliations/' + rec.id + '/close', f.emp, 'POST', { reason: 'Đóng' })).status,
    403,
  );
  assert.equal((await f.call('/cash/reconciliations/' + rec.id + '/close', f.mgr, 'POST', {})).status, 400);
  assert.equal(
    (await f.call('/cash/reconciliations/' + rec.id + '/close', f.mgr, 'POST', { reason: 'Đã đối chiếu' })).status,
    200,
  );
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 500000);
  assert.ok((await f.db.select().from(auditLogs)).filter((a) => a.module === 'cash').length >= 5);
});
test('Cash: huỷ phiếu bán hàng đã kết giữ báo cáo, bỏ tiền khỏi két, tra soát không tạo trùng', async () => {
  const f = await setup(),
    s = await f.open(),
    bill = await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id));
  assert.equal(bill.status, 201);
  await f.call('/cash/shifts/' + s.id + '/close', f.emp, 'POST', { countedCash: 694400 });
  const [p] = await f.db.select().from(customerPayments);
  assert.ok(p);
  const body = { reason: 'Thu nhầm, cần xử lý lại' };
  assert.equal((await f.call('/payments/' + p.id + '/void', f.mgr, 'POST', body)).status, 200);
  assert.equal((await f.call('/cash', f.mgr)).data.balance, 500000);
  assert.equal((await f.call('/cash/shifts/' + s.id, f.emp)).data.expectedCash, 694400);
  assert.equal((await f.db.select().from(cashReconciliations)).length, 1);
});
test('Cash: RLS và REVOKE chặn truy cập trực tiếp ba bảng', async () => {
  const f = await setup();
  await f.client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  const path = readdirSync('migrations/postgres').find((x) => x.endsWith('_supabase_access_cash_drawer.sql'))!;
  await f.client.exec(readFileSync('migrations/postgres/' + path, 'utf8'));
  const { rows } = await f.client.query<{ relrowsecurity: boolean; allowed: boolean }>(
    "select relrowsecurity,has_table_privilege('anon',oid,'SELECT') as allowed from pg_class where relname in ('cash_drawers','cash_entries','cash_reconciliations')",
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.relrowsecurity && !r.allowed));
});
