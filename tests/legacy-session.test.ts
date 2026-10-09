import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportLegacySession, restoreLegacySession, fetchLegacyMedia, resetLegacySession, LegacyRateLimitError } from '../src/modules/integrations/api/legacy-site.ts';

const base = 'https://baogia.minhlongonline.com', url = base + '/api/staff/media-file?key=' + 'a'.repeat(64);
function fixture() {
  let logins = 0, valid = '';
  const site = { base, email: 'test@example.com', password: 'test-only-password', fetch: (async (input, init) => {
    if (String(input).endsWith('/login')) {
      valid = 'session-' + ++logins;
      return new Response('{}', { headers: { 'set-cookie': '__Host-bn-session=' + valid + '; Path=/; Secure; HttpOnly' } });
    }
    return new Response('', { status: new Headers(init?.headers).get('cookie') === '__Host-bn-session=' + valid ? 200 : 401 });
  }) as typeof fetch };
  return { env: { legacySite: site } as Parameters<typeof fetchLegacyMedia>[0], logins: () => logins, expire: () => { valid = 'expired'; } };
}

test('migration keeps encrypted legacy session across Edge cold starts', async () => {
  resetLegacySession();
  const f = fixture();
  await fetchLegacyMedia(f.env, url);
  const token = await exportLegacySession(f.env, 'manager-session');
  assert.ok(token);
  assert.ok(!atob(token).includes('session-1'), 'cookie is not exposed as plaintext');
  for (let i = 0; i < 15; i++) {
    resetLegacySession();
    await restoreLegacySession(f.env, 'manager-session', token);
    assert.equal((await fetchLegacyMedia(f.env, url)).status, 200);
  }
  assert.equal(f.logins(), 1, '15 new isolates do not make 15 new logins');
  f.expire();
  resetLegacySession();
  await restoreLegacySession(f.env, 'manager-session', token);
  assert.equal((await fetchLegacyMedia(f.env, url)).status, 200);
  assert.equal(f.logins(), 2, 'expired remote cookie still refreshes normally');
});

test('legacy session tokens reject tampering, another manager session, changed credentials and expiry', async () => {
  resetLegacySession();
  const f = fixture();
  await fetchLegacyMedia(f.env, url);
  const token = await exportLegacySession(f.env, 'owner');
  assert.ok(token);
  for (const [owner, value] of [['other', token], ['owner', 'bad-token'], ['owner', token.slice(0, 20) + 'AAAA' + token.slice(24)]]) {
    resetLegacySession();
    const before = f.logins();
    await restoreLegacySession(f.env, owner, value);
    await fetchLegacyMedia(f.env, url);
    assert.equal(f.logins(), before + 1);
  }
  resetLegacySession();
  f.env.legacySite!.password = 'changed-password';
  let before = f.logins();
  await restoreLegacySession(f.env, 'owner', token);
  await fetchLegacyMedia(f.env, url);
  assert.equal(f.logins(), before + 1);
  const fresh = await exportLegacySession(f.env, 'owner');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 3601_000;
    resetLegacySession(); before = f.logins();
    await restoreLegacySession(f.env, 'owner', fresh);
    await fetchLegacyMedia(f.env, url);
    assert.equal(f.logins(), before + 1);
  } finally { Date.now = realNow; resetLegacySession(); }
});

test('429 reports cooldown separately from wrong credentials, respecting Retry-After', async () => {
  for (const [header, expected] of [['120', 120], ['', 900], ['invalid', 900]]) {
    resetLegacySession();
    const f = fixture();
    f.env.legacySite!.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': header } });
    await assert.rejects(fetchLegacyMedia(f.env, url), (e: unknown) => {
      assert.ok(e instanceof LegacyRateLimitError);
      assert.equal(e.status, 429); assert.equal(e.retryAfter, expected);
      assert.ok(!e.message.includes('LEGACY_STAFF_PASSWORD'));
      return true;
    });
  }
  resetLegacySession();
});
