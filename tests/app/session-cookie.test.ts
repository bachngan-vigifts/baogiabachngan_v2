import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { SYNC_PREFIX } from '../../src/modules/staff/api/auth-routes.ts';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, edgeRequestHeaders, edgeResponseCookies } from '../../src/modules/staff/api/edge-session.ts';
// @ts-expect-error – Pages Function viết bằng JS thuần (không có khai báo kiểu)
import { onRequest } from '../../functions/api/staff/[[path]].js';

/**
 * Cookie phiên first-party: trình duyệt → https://crm.test/api/staff/* (Pages Function proxy) → Edge Function → router.
 * Edge Function được mô phỏng đúng phần xử lý phiên của supabase/functions/baogia-v2-api/index.ts.
 */
const SITE = 'https://crm.test', UPSTREAM = 'https://edge.test/functions/v1/baogia-v2-api', SECRET = 's'.repeat(40);
const COOKIE_RE = /^__Host-bn-session=([a-f0-9]{64}); Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/;

async function world(t: import('node:test').TestContext) {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const upstream: Request[] = [], seenIp: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const req = new Request(input, init); upstream.push(req.clone());
    const url = new URL(req.url), path = url.pathname.slice(url.pathname.indexOf('/api/staff'));
    const origin = req.headers.get('origin') || '';
    const { headers, legacyToken } = edgeRequestHeaders(req.headers, { sync: path.startsWith(SYNC_PREFIX), proxySecret: SECRET });
    seenIp.push(headers.get('cf-connecting-ip') || '');
    const res = await router.handle(new Request(origin + path + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer() }), { db, passwordIterations: 1000 });
    const out = new Headers({ 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': origin });
    for (const c of edgeResponseCookies(res, legacyToken)) out.append('set-cookie', c);
    return new Response(await res.text(), { status: res.status, headers: out });
  });
  const env = { API_UPSTREAM: UPSTREAM, API_PROXY_SECRET: SECRET };
  /** Trình duyệt gọi cùng nguồn: GET không gửi Origin, POST gửi Origin của trang. */
  const call = async (path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string; authorization?: string } = {}) => {
    const method = o.method ?? (o.body ? 'POST' : 'GET');
    const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' };
    if (method !== 'GET') headers.origin = o.origin ?? SITE;
    else if (o.origin) headers.origin = o.origin;
    if (o.cookie) headers.cookie = o.cookie;
    if (o.authorization) headers.authorization = o.authorization;
    const res: Response = await onRequest({ request: new Request(SITE + '/api/staff' + path, { method, headers, body: o.body ? JSON.stringify(o.body) : undefined }), env });
    const setCookie = res.headers.getSetCookie();
    return { res, status: res.status, body: await res.json() as any, setCookie, cookie: setCookie[0]?.split(';')[0] ?? '' };
  };
  return { call, upstream, seenIp };
}

test('đăng nhập qua proxy cùng tên miền: token chỉ nằm trong cookie HttpOnly first-party, không có trong JSON', async t => {
  const w = await world(t);
  const login = await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.body.sessionToken, undefined);
  assert.doesNotMatch(JSON.stringify(login.body), /[a-f0-9]{64}/, 'không lộ token trong thân phản hồi');
  assert.match(login.setCookie[0]!, COOKIE_RE);
  assert.equal(login.res.headers.get('access-control-allow-origin'), null, 'cùng nguồn: bỏ header CORS');
  assert.equal(w.upstream[0]!.url, UPSTREAM + '/api/staff/login');
  // GET cùng nguồn không có Origin: proxy tự ghi Origin của trang (API bắt buộc).
  const me = await w.call('/me', { cookie: login.cookie + '; _ga=x' });
  assert.equal(me.status, 200); assert.equal(me.body.user.email, 'emp@x.vn');
  assert.equal(w.upstream[1]!.headers.get('origin'), SITE);
  // Đăng xuất: cookie bị xoá, phiên hết hiệu lực.
  const out = await w.call('/logout', { body: {}, cookie: login.cookie });
  assert.match(out.setCookie[0]!, /^__Host-bn-session=; .*Max-Age=0$/);
  assert.equal((await w.call('/me', { cookie: login.cookie })).status, 401);
});

test('proxy từ chối trang khác gọi sang (CSRF / CORS) mà không chuyển tới API', async t => {
  const w = await world(t);
  for (const method of ['GET', 'POST']) {
    const r = await w.call('/me', { method, origin: 'https://evil.test', ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(r.status, 403, method);
  }
  assert.equal(w.upstream.length, 0);
});

test('IP người dùng đi qua proxy chỉ khi có mã bí mật đúng (giới hạn số lần đăng nhập theo IP thật)', async t => {
  const w = await world(t);
  await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD } });
  assert.equal(w.seenIp[0], '203.0.113.7');
  const h = (secret: string) => new Headers({ [PROXY_SECRET_HEADER]: secret, [CLIENT_IP_HEADER]: '198.51.100.9', 'cf-connecting-ip': '2a06:98c0:3600::103' });
  assert.equal(edgeRequestHeaders(h(SECRET), { sync: false, proxySecret: SECRET }).headers.get('cf-connecting-ip'), '198.51.100.9');
  for (const [got, conf] of [['sai'.repeat(14), SECRET], [SECRET, ''], ['ngan', 'ngan']]) {
    const out = edgeRequestHeaders(h(got!), { sync: false, proxySecret: conf! }).headers;
    assert.equal(out.get('cf-connecting-ip'), '2a06:98c0:3600::103');
    assert.equal(out.get(PROXY_SECRET_HEADER), null); assert.equal(out.get(CLIENT_IP_HEADER), null);
  }
});

test('token cũ (Bearer từ localStorage) được đổi sang cookie một lần; token sai không được cookie', async t => {
  const w = await world(t);
  const token = (await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD } })).cookie.split('=')[1]!;
  const migrated = await w.call('/me', { authorization: 'Bearer ' + token });
  assert.equal(migrated.status, 200);
  assert.match(migrated.setCookie[0]!, COOKIE_RE);
  assert.equal(migrated.cookie, '__Host-bn-session=' + token);
  const bad = await w.call('/me', { authorization: 'Bearer ' + 'f'.repeat(64) });
  assert.equal(bad.status, 401); assert.deepEqual(bad.setCookie, []);
});

test('Edge Function: chỉ chuyển cookie phiên; luồng đồng bộ Sapo không dùng cookie, giữ Authorization', () => {
  const tok = 'a'.repeat(64), other = 'b'.repeat(64);
  const web = edgeRequestHeaders(new Headers({ cookie: `x=1; __Host-bn-session=${tok}; y=2`, authorization: 'Bearer ' + other }), { sync: false });
  assert.equal(web.headers.get('cookie'), `__Host-bn-session=${tok}`);
  assert.equal(web.headers.get('authorization'), null);
  assert.equal(web.legacyToken, '', 'đã có cookie: không đặt lại từ Bearer');
  const sync = edgeRequestHeaders(new Headers({ cookie: `__Host-bn-session=${tok}`, authorization: 'Bearer bi-mat-dong-bo' }), { sync: true });
  assert.equal(sync.headers.get('cookie'), null);
  assert.equal(sync.headers.get('authorization'), 'Bearer bi-mat-dong-bo');
  assert.equal(edgeRequestHeaders(new Headers({ cookie: '__Host-bn-session=abc' }), { sync: false }).headers.get('cookie'), null);
});

test('Edge Function không còn chép token vào JSON', async () => {
  const { readFileSync } = await import('node:fs');
  const edge = readFileSync(new URL('../../supabase/functions/baogia-v2-api/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(edge, /sessionToken/);
  assert.match(edge, /edgeResponseCookies\(response, legacyToken\)/);
});
