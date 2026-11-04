import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { reportMonths } from '../../src/app/report-routes.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { hrPayslips } from '../../src/modules/hr/schema.ts';

test('report range validates strict months, ordering and 12-month limit', () => {
  for (const query of ['', 'from=2026-00&to=2026-01', 'from=2026-01&to=2026-13',
    'from=2026-02&to=2026-01', 'from=2025-01&to=2026-01', 'from=0000-01&to=0000-02']) {
    assert.throws(() => reportMonths(new URLSearchParams(query)));
  }
  const f = reportMonths(new URLSearchParams('from=2025-12&to=2026-02'));
  assert.deepEqual(f.months, ['2025-12', '2026-01', '2026-02']);
  assert.equal(f.next, '2026-03');
  assert.equal(reportMonths(new URLSearchParams('from=2026-01&to=2026-12')).months.length, 12);
});

test('business report restricts access and aggregates sales/payroll independently across month boundaries', async () => {
  // Arrange: real Postgres engine with all migrations, multiple orders and payslips.
  const { db, d1, client } = await createTestDb();
  await seedStaff(d1);
  const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', body?: object) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, {
      method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const emp = (await call('/login', '', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  const path = '/reports/business?from=2026-01&to=2026-03';
  assert.equal((await call(path)).status, 401);
  assert.equal((await call(path, emp)).status, 403);
  assert.equal((await call('/reports/business?from=bad&to=2026-01', mgr)).status, 400);
  for (const [id, date, status, amount] of [
    ['a', '2026-01-01', 'confirmed', 100], ['b', '2026-01-31', 'delivered', 200],
    ['c', '2026-02-01', 'delivering', 50], ['d', '2026-01-15', 'draft', 900],
    ['e', '2026-01-15', 'cancelled', 900], ['f', '2025-12-31', 'confirmed', 900],
    ['g', '2026-04-01', 'confirmed', 900],
  ] as const) await db.insert(salesOrders).values({ id, orderNo: id, orderDate: date, status,
    quoteType: 'HRC', customerName: 'KH', ownerId: 'emp', createdBy: 'emp',
    subtotal: amount, total: amount * 11 / 10, createdAt: '', updatedAt: '' });
  await db.insert(hrPayslips).values([
    { memberId: 'emp', month: '2026-01', gross: 100, deductionTotal: 20, net: 80, confirmedAt: '', status: 'paid' },
    { memberId: 'mgr', month: '2026-01', gross: 200, deductionTotal: 50, net: 150, confirmedAt: '' },
    { memberId: 'emp', month: '2025-12', gross: 900, net: 900, confirmedAt: '' },
  ]);
  // Act and assert: no join multiplication, zero-filled missing months, no personal data.
  const result = await call(path, mgr);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.rows, [
    { month: '2026-01', sales: { orders: 2, subtotal: 300, total: 330 }, payroll: { payslips: 2, gross: 300, deductions: 70, net: 230, paid: 80 } },
    { month: '2026-02', sales: { orders: 1, subtotal: 50, total: 55 }, payroll: { payslips: 0, gross: 0, deductions: 0, net: 0, paid: 0 } },
    { month: '2026-03', sales: { orders: 0, subtotal: 0, total: 0 }, payroll: { payslips: 0, gross: 0, deductions: 0, net: 0, paid: 0 } },
  ]);
  await assert.rejects(db.insert(hrPayslips).values({ memberId: 'emp', month: '2026-13', gross: 1, net: 1, confirmedAt: '' }));
  const indexes = await client.query<{ indexname: string }>("select indexname from pg_indexes where indexname = 'idx_sales_orders_report_date'");
  assert.equal(indexes.rows.length, 1);
});
