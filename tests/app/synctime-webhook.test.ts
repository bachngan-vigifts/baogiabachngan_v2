import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppRouter } from '../../src/app/router.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { synctimeConnections, synctimeReceipts } from '../../src/modules/integrations/schema.ts';
import { hrAttendance } from '../../src/modules/hr/schema.ts';
import { sha256Hex } from '../../src/modules/staff/domain/session.ts';
import { authAttempts } from '../../src/modules/staff/schema.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const push = async (token: string, text: string, headers = {}) => {
    const r = await router.handle(new Request(origin + '/api/staff/integrations/synctime/webhook', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...headers }, body: text }), { db, sapoSyncToken: 'a'.repeat(64) });
    return { status: r.status, data: await r.json() as any };
  };
  return { call, push, db, client, router, mgr: await login('mgr@x.vn'), emp: await login('emp@x.vn'), ncc: await login('ncc@x.vn') };
}

test('SyncTime: only Manager manages keys / samples; generated secret stored hashed, GET never returns it', async () => {
  const { call, mgr, emp, ncc, db } = await setup();
  assert.equal((await call('/hr/synctime')).status, 401);
  for (const cookie of [emp, ncc]) {
    assert.equal((await call('/hr/synctime', cookie)).status, 403);
    assert.equal((await call('/hr/synctime/key', cookie, 'POST', {})).status, 403);
    assert.equal((await call('/hr/synctime/key', cookie, 'DELETE')).status, 403);
    assert.equal((await call('/hr/synctime/receipts/' + 'a'.repeat(64), cookie)).status, 403);
  }
  const made = await call('/hr/synctime/key', mgr, 'POST', {}); assert.equal(made.status, 200);
  const secret = made.data.header.slice('Authorization: Bearer '.length);
  assert.match(secret, /^stwh_[a-f0-9]{64}$/);
  assert.equal((await db.select().from(synctimeConnections))[0]?.tokenHash, sha256Hex(secret));
  assert.ok(!JSON.stringify((await call('/hr/synctime', mgr)).data).includes(secret));
  assert.equal((await call('/hr/synctime/key', mgr, 'POST', {})).status, 409);
});

test('SyncTime: authenticated server POST without Origin; no cookie/Sapo-token bypass, dedup, sample privacy and no payroll writes', async () => {
  const { call, push, mgr, emp, db, router } = await setup();
  const secret = (await call('/hr/synctime/key', mgr, 'POST', {})).data.header.slice('Authorization: Bearer '.length);
  const raw = JSON.stringify({ unknown_provider_field: [{ employee: '001', note: '<script>bad</script>' }] });
  assert.equal((await push('', raw)).status, 401);
  assert.equal((await push('a'.repeat(64), raw)).status, 401, 'Sapo secret cannot authenticate SyncTime');
  assert.equal((await push('', raw, { cookie: mgr })).status, 401, 'Manager session alone is not webhook authentication');
  const first = await push(secret, raw); assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.duplicate, false); assert.equal(first.data.processing, 'pending_schema_review');
  assert.equal((await push(secret, raw)).data.duplicate, true);
  assert.equal((await db.select().from(synctimeReceipts)).length, 1);
  assert.equal((await db.select().from(hrAttendance)).length, 0);
  const id = first.data.id;
  assert.equal((await call('/hr/synctime/receipts/' + id, emp)).status, 403);
  assert.equal((await call('/hr/synctime/receipts/' + id, mgr)).data.payloadText, raw);
  const bigId = '{"id":9007199254740993}';
  const big = await push(secret, bigId);
  assert.equal((await call('/hr/synctime/receipts/' + big.data.id, mgr)).data.payloadText, bigId, 'không làm tròn mã log lớn khi lưu gói mẫu');
  const r = await router.handle(new Request(origin + '/api/staff/hr/synctime/key', { method: 'POST', headers: { cookie: mgr, 'content-type': 'application/json' }, body: '{}' }), { db });
  assert.equal(r.status, 403, 'key-management endpoints retain CSRF protection');
  await call('/hr/synctime/key', mgr, 'DELETE'); assert.equal((await push(secret, raw)).status, 401);
});

test('SyncTime: bounded JSON, arrays supported, invalid JSON rejected, key rotation revokes old key', async () => {
  const { call, push, mgr, db, client } = await setup();
  const secret = (await call('/hr/synctime/key', mgr, 'POST', {})).data.header.slice('Authorization: Bearer '.length);
  assert.equal((await push(secret, '{bad')).status, 400);
  assert.equal((await push(secret, '123')).status, 400);
  assert.equal((await push(secret, '{}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await push(secret, JSON.stringify({ data: 'a'.repeat(131073) }))).status, 413);
  assert.equal((await db.select().from(synctimeReceipts)).length, 0);
  assert.equal((await push(secret, '[{"test":1}]')).status, 200);
  const replacement = (await call('/hr/synctime/key', mgr, 'POST', { replace: true })).data.header.slice('Authorization: Bearer '.length);
  assert.notEqual(replacement, secret); assert.equal((await push(secret, '{}')).status, 401);
  assert.equal((await push(replacement, '{}')).status, 200);
  const rls = await client.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('synctime_connections','synctime_receipts')");
  assert.equal(rls.rows.length, 2); assert.ok(rls.rows.every(r => r.relrowsecurity));
  await client.exec('CREATE ROLE anon; CREATE ROLE authenticated; GRANT ALL ON synctime_connections, synctime_receipts TO PUBLIC, anon, authenticated;');
  await client.exec(readFileSync(new URL('../../migrations/postgres/20261017075450_supabase_access_synctime_webhook.sql', import.meta.url), 'utf8'));
  const grants = await client.query<{ allowed: boolean }>(`SELECT has_table_privilege(r.role,t.tab,p.priv) AS allowed
    FROM (VALUES ('anon'),('authenticated')) r(role) CROSS JOIN (VALUES ('synctime_connections'),('synctime_receipts')) t(tab)
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv)`);
  assert.ok(grants.rows.every(r => !r.allowed));
});

test('SyncTime: bounded intake rate and 30-day receipt retention', async () => {
  const { call, push, mgr, db } = await setup();
  const secret = (await call('/hr/synctime/key', mgr, 'POST', {})).data.header.slice('Authorization: Bearer '.length);
  await db.insert(synctimeReceipts).values({ id: 'a'.repeat(64), payload: '{}', receivedAt: new Date(Date.now() - 31 * 864e5).toISOString() });
  assert.equal((await push(secret, '{"current":1}')).status, 200);
  assert.equal((await db.select().from(synctimeReceipts)).length, 1);
  const now = Math.floor(Date.now() / 1000), key = sha256Hex('synctime-webhook:' + Math.floor(now / 60));
  await db.insert(authAttempts).values({ key, count: 120, expires: now + 900 }).onConflictDoUpdate({ target: authAttempts.key, set: { count: 120, expires: now + 900 } });
  assert.equal((await push(secret, '{"current":2}')).status, 429);
  assert.equal((await db.select().from(synctimeReceipts)).length, 1);
});
