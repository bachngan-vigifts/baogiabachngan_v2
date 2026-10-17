import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { admsLogs, admsSyncState } from '../../src/modules/hr/adms-schema.ts';
import { hrAttendance } from '../../src/modules/hr/schema.ts';
import { admsConfig, admsRange, fetchAdmsLogs, type AdmsConfig } from '../../src/modules/hr/domain/adms.ts';

const origin = 'https://trial.test', dates = { from: '2026-10-01', to: '2026-10-31' };
const log = (id: number, extra = {}) => ({ log_id: String(id), company_id: 1, emp_code: '001', full_name: 'Nhân viên máy',
  check_time: '2026-10-17 08:00:00', punch_state: 0, device_serial: 'SN1', source: 'device', ...extra });
const page = (data: unknown[], total = data.length, n = 1) => Response.json({ status: 'success', total, page: n, limit: 200, data });
const cfg = (fn: typeof fetch): AdmsConfig => ({ url: 'https://adms.example.test/iclock/api/get_attendance.php', companyId: 1, token: 'a'.repeat(40), fetch: fn });

async function setup() {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(); let config: AdmsConfig | undefined;
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, adms: config });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, client, call, configure: (v: AdmsConfig) => { config = v; }, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('ADMS: validates dates, config, follows pagination, sends bearer only to configured HTTPS URL', async () => {
  assert.throws(() => admsRange('2026-02-30', '2026-03-01'));
  assert.throws(() => admsRange('2026-10-01', '2026-11-01'));
  assert.throws(() => admsConfig({ ...cfg(fetch), url: 'http://adms.test/api' }));
  assert.throws(() => admsConfig({ ...cfg(fetch), url: 'https://adms.test/api?token=secret' }));
  const requests: URL[] = [];
  const config = cfg(async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + 'a'.repeat(40));
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    const n = Number(url.searchParams.get('page'));
    return page(n === 1 ? Array.from({ length: 200 }, (_, i) => log(i + 1)) : [log(201)], 201, n);
  });
  const rows = await fetchAdmsLogs(config, dates.from, dates.to);
  assert.equal(rows.length, 201); assert.equal(rows[0]?.empCode, '001');
  assert.equal(rows[0]?.checkTime, '2026-10-17 08:00:00', 'preserve Vietnam wall clock');
  assert.equal(requests.length, 2); assert.equal(requests[1]?.searchParams.get('from_date'), '2026-10-01 00:00:00');
});

test('ADMS: refuses inconsistent/cross-company/partial data and masks upstream errors', async () => {
  for (const extra of [{ company_id: 2 }, { check_time: '2026-09-30 08:00:00' }, { emp_code: '' }, { punch_state: '' }, { log_id: Number.MAX_SAFE_INTEGER + 1 }])
    await assert.rejects(fetchAdmsLogs(cfg(async () => page([log(1, extra)])), dates.from, dates.to));
  await assert.rejects(fetchAdmsLogs(cfg(async () => page([log(1), log(1)])), dates.from, dates.to));
  await assert.rejects(fetchAdmsLogs(cfg(async () => page([], 1)), dates.from, dates.to));
  await assert.rejects(fetchAdmsLogs(cfg(async () => page([], 5001)), dates.from, dates.to), /5.000/);
  await assert.rejects(fetchAdmsLogs(cfg(async () => { throw new Error('token-leak-secret'); }), dates.from, dates.to), e => !String(e).includes('token-leak-secret'));
  await assert.rejects(fetchAdmsLogs(cfg(async () => new Response('private SQL password', { status: 500 })), dates.from, dates.to), e => !String(e).includes('private SQL'));
});

test('ADMS API: Manager only; missing config; sync deduplication, mappings and payroll remain separate', async () => {
  const { call, mgr, emp, configure, db, client } = await setup();
  assert.equal((await call('/hr/adms')).status, 401);
  assert.equal((await call('/hr/adms', emp)).status, 403);
  assert.deepEqual((await call('/hr/adms', mgr)).data, { configured: false, companyId: null, lastSync: null });
  assert.equal((await call('/hr/adms/sync', mgr, 'POST', dates)).status, 503);
  configure(cfg(async () => page([log(1), log(2, { check_time: '2026-10-17 17:00:00', punch_state: 1 })])));
  for (const [path, method, body] of [['/hr/adms/sync', 'POST', dates], ['/hr/adms/logs?from=2026-10-01&to=2026-10-31', 'GET', undefined],
    ['/hr/adms/mappings', 'GET', undefined], ['/hr/adms/mappings', 'PUT', { empCode: '001', memberId: 'emp' }], ['/hr/adms/mappings/001', 'DELETE', undefined]] as const)
    assert.equal((await call(path, emp, method, body)).status, 403, path);
  const first = await call('/hr/adms/sync', mgr, 'POST', dates);
  assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.inserted, 2);
  const second = await call('/hr/adms/sync', mgr, 'POST', dates); assert.equal(second.data.inserted, 0); assert.equal(second.data.existing, 2);
  assert.equal((await db.select().from(hrAttendance)).length, 0, 'never rewrite attendance/payroll');
  assert.equal((await call('/hr/adms/mappings', mgr, 'PUT', { empCode: '001', memberId: 'emp' })).status, 200);
  assert.equal((await call('/hr/adms/mappings', mgr, 'PUT', { empCode: '002', memberId: 'emp' })).status, 409);
  assert.equal((await call('/hr/adms/mappings', mgr, 'PUT', { empCode: '002', memberId: 'missing' })).status, 404);
  const listing = await call('/hr/adms/logs?from=2026-10-01&to=2026-10-31', mgr);
  assert.equal(listing.data.total, 2); assert.equal(listing.data.logs[0].checkTime, '2026-10-17 17:00:00'); assert.equal(listing.data.logs[0].memberId, 'emp');
  assert.equal((await call('/hr/adms/logs?from=2026-10-01&to=2026-10-31&empCode=missing', mgr)).data.total, 0);
  assert.equal((await call('/hr/adms/mappings/001', mgr, 'DELETE')).status, 200);
  assert.equal((await call('/hr/adms/logs?from=2026-10-01&to=2026-10-31', mgr)).data.logs[0].memberId, null);
  const status = await call('/hr/adms', mgr); assert.ok(status.data.lastSync.syncedAt); assert.ok(!JSON.stringify(status.data).includes('https://'));
  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname in ('hr_adms_logs','hr_adms_members','hr_adms_sync_state')");
  assert.equal(rls.rows.length, 3); assert.ok(rls.rows.every(r => r.relrowsecurity));
  await client.exec('CREATE ROLE anon; CREATE ROLE authenticated; GRANT ALL ON hr_adms_logs, hr_adms_members, hr_adms_sync_state TO PUBLIC, anon, authenticated;');
  await client.exec(readFileSync(new URL('../../migrations/postgres/20261017033437_supabase_access_adms.sql', import.meta.url), 'utf8'));
  const grants = await client.query<{ allowed: boolean }>(`SELECT has_table_privilege(r.role, t.tab, p.priv) AS allowed
    FROM (VALUES ('anon'), ('authenticated')) r(role)
    CROSS JOIN (VALUES ('hr_adms_logs'), ('hr_adms_members'), ('hr_adms_sync_state')) t(tab)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)`);
  assert.equal(grants.rows.length, 24); assert.ok(grants.rows.every(r => !r.allowed), 'no direct access for public API roles');
});

test('ADMS: failure on later page writes neither logs nor successful sync marker', async () => {
  const { call, mgr, configure, db } = await setup();
  configure(cfg(async input => Number(new URL(String(input)).searchParams.get('page')) === 1
    ? page(Array.from({ length: 200 }, (_, i) => log(i + 1)), 201, 1) : new Response('failed', { status: 500 })));
  assert.equal((await call('/hr/adms/sync', mgr, 'POST', dates)).status, 502);
  assert.equal((await db.select().from(admsLogs)).length, 0);
  assert.equal((await db.select().from(admsSyncState).where(eq(admsSyncState.companyId, 1))).length, 0);
});
