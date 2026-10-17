/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../../../tests/helpers/postgres.ts';
import { seedStaff, PASSWORD, token, T } from '../../../../tests/helpers/staff-fixture.ts';
import { clientIp, createStaffRouter, type StaffEnv } from './auth-routes.ts';
import { json } from '../../../core/http/router.ts';
import { RATE_LIMITS, SESSION_COOKIE, shouldRenewSession, SESSION_LIFETIME_SECONDS } from '../domain/session.ts';

const O = 'https://staff.test';
async function world() {
  const { db, d1 } = (await createTestDb()); await seedStaff(d1);
  const clock = { t: T.now };
  const env: StaffEnv = { db, nowSec: () => clock.t, passwordIterations: 1000 };
  const router = createStaffRouter();
  // route thử cho từng khu vực (module khác sẽ tự đăng ký route thật)
  router.get('/biz', () => json({ biz: true }), 'business').get('/portal', () => json({ portal: true }), 'supplier-portal').get('/ncc-admin', () => json({ a: true }), 'ncc-admin');
  const call = async (path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string | null; type?: string | null; ip?: string; raw?: string } = {}) => {
    const method = o.method ?? (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET');
    const headers: Record<string, string> = {};
    if (o.origin !== null) headers.origin = o.origin ?? O;
    if (o.type !== null && (o.body !== undefined || o.raw !== undefined)) headers['content-type'] = o.type ?? 'application/json';
    if (o.cookie) headers.cookie = o.cookie;
    if (o.ip) headers['cf-connecting-ip'] = o.ip;
    const r = await router.handle(new Request(O + '/api/staff' + path, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) }), env);
    return { status: r.status, body: await r.json() as any, cookie: r.headers.get('set-cookie') };
  };
  const login = async (email: string, password = PASSWORD) => { const r = await call('/login', { body: { email, password } }); return { ...r, cookie: r.cookie?.split(';')[0] ?? '' }; };
  return { db, d1, call, login, clock, router, env };
}

test('MỌI route của staff đều khai báo khu vực truy cập (không có route "quên" quyền)', async () => {
  const { router } = await world();
  const routes = router.list();
  assert.ok(routes.length >= 6);
  for (const r of routes) assert.ok(['public', 'self', 'supplier-portal', 'ncc-admin', 'admin', 'business'].includes(r.meta as string), `${r.method} ${r.pattern}`);
  assert.deepEqual(routes.filter(r => r.meta === 'public').map(r => r.pattern.replace(/[\^$\\/?]/g, '')).sort(), ['activate', 'activation-info', 'login']);
});

test('vòng đời tài khoản: xem liên kết → kích hoạt → đăng nhập → /me → đăng xuất', async () => {
  const w = await world();
  const info = await w.call('/activation-info', { body: { token: token(1) } });
  assert.deepEqual([info.status, info.body.email, info.body.expiresAt], [200, 'new@x.vn', (T.now + 600) * 1000]);
  assert.equal((await w.call('/activate', { body: { token: token(1), password: PASSWORD } })).status, 200);
  const l = await w.login('new@x.vn');
  assert.equal(l.status, 200);
  assert.match(l.cookie, new RegExp(`^${SESSION_COOKIE}=[a-f0-9]{64}$`));
  const me = await w.call('/me', { cookie: l.cookie });
  assert.deepEqual([me.status, me.body.user.email, me.body.user.position], [200, 'new@x.vn', 'Sale']);
  const out = await w.call('/logout', { body: {}, cookie: l.cookie });
  assert.equal(out.status, 200);
  assert.match(out.cookie!, /Max-Age=0/);
  assert.equal((await w.call('/me', { cookie: l.cookie })).status, 401);
});

test('cookie phiên: HttpOnly, Secure, SameSite=Strict, Path=/, sống 30 ngày, tên __Host-', async () => {
  const w = await world();
  const r = await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD } });
  assert.match(r.cookie!, /^__Host-bn-session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
});

test('liên kết kích hoạt chỉ dùng được MỘT lần, kể cả khi hai người bấm cùng lúc', async () => {
  const w = await world();
  const results = await Promise.all([1, 2, 3, 4].map(() => w.call('/activate', { body: { token: token(1), password: PASSWORD }, ip: '1.1.1.1' })));
  assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results.map(r => r.status)));
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 400));
  const row = (await w.d1.sqlite.prepare("SELECT version, activation_hash h FROM staff_credentials WHERE member_id='new'").get()) as any;
  assert.deepEqual([row.version, row.h], [1, null]); // phiên bản tăng đúng một lần
});

test('liên kết hết hạn / sai định dạng / không tồn tại: thông báo đúng', async () => {
  const w = await world();
  assert.equal((await w.call('/activation-info', { body: { token: 'abc' } })).body.error, 'Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.');
  for (const t of [token(2), token(99)]) assert.match((await w.call('/activation-info', { body: { token: t } })).body.error, /^Liên kết đã hết hạn, đã sử dụng/);
  assert.equal((await w.call('/activate', { body: { token: token(1), password: 'ngan' } })).body.error, 'Mật khẩu cần từ 8 đến 128 ký tự. Có thể dùng một cụm từ dễ nhớ.');
});

test('đăng nhập sai: cùng một thông báo cho email lạ, sai mật khẩu, tài khoản khoá, chưa kích hoạt (không lộ tài khoản nào tồn tại)', async () => {
  const w = await world();
  const msgs = new Set<string>();
  for (const [email, password] of [['khong-co@x.vn', PASSWORD], ['emp@x.vn', 'sai-mat-khau'], ['off@x.vn', PASSWORD], ['new@x.vn', PASSWORD], ['emp@x.vn', undefined as any]]) {
    const r = await w.call('/login', { body: { email, password } });
    assert.equal(r.status, 401); msgs.add(r.body.error); assert.equal(r.cookie, null);
  }
  assert.deepEqual([...msgs], ['Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được kích hoạt.']);
});

test('email được chuẩn hoá (cắt khoảng trắng, hạ chữ) khi đăng nhập', async () => {
  const w = await world();
  assert.equal((await w.call('/login', { body: { email: '  EMP@X.vn ', password: PASSWORD } })).status, 200);
});

test('giới hạn thử: quá 10 lần/email trong 15 phút bị chặn 429 (kể cả mật khẩu đúng); hết cửa sổ thì đếm lại', async () => {
  const w = await world();
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await w.call('/login', { body: { email: 'emp@x.vn', password: 'sai-sai-sai' } })).status);
  assert.deepEqual(codes, [...Array(RATE_LIMITS.email).fill(401), 429, 429]);
  assert.equal((await w.login('emp@x.vn')).status, 429); // mật khẩu đúng cũng bị chặn
  assert.equal((await w.login('mgr@x.vn')).status, 200); // email khác không bị ảnh hưởng
  w.clock.t += 901;
  assert.equal((await w.login('emp@x.vn')).status, 200);
});

test('đăng nhập đúng xoá bộ đếm của tài khoản: đăng nhập đúng nhiều lần không bị khoá; sai 9 lần rồi đúng thì đếm lại từ đầu', async () => {
  const w = await world();
  for (let i = 0; i < RATE_LIMITS.email + 3; i++) assert.equal((await w.login('emp@x.vn')).status, 200, `lần ${i + 1}`);
  for (let i = 0; i < RATE_LIMITS.email - 1; i++) await w.call('/login', { body: { email: 'emp@x.vn', password: 'sai-sai-sai' } });
  assert.equal((await w.login('emp@x.vn')).status, 200);
  const codes: number[] = [];
  for (let i = 0; i < RATE_LIMITS.email + 1; i++) codes.push((await w.call('/login', { body: { email: 'emp@x.vn', password: 'sai-sai-sai' } })).status);
  assert.deepEqual(codes, [...Array(RATE_LIMITS.email).fill(401), 429], 'bộ đếm đã về 0 sau lần đăng nhập đúng');
});

test('IP giới hạn thử: cf-connecting-ip (Cloudflare ghi đè); thiếu thì phần tử CUỐI của x-forwarded-for (phần đầu trình duyệt giả được)', () => {
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '6.6.6.6' })), '1.1.1.1');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 2.2.2.2' })), '2.2.2.2');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('giới hạn theo IP: quá 100 lần/IP bị chặn dù đổi email', async () => {
  const w = await world();
  let last = 0;
  for (let i = 0; i < 101; i++) last = (await w.call('/login', { body: { email: `u${i}@x.vn`, password: 'sai-sai-sai' }, ip: '9.9.9.9' })).status;
  assert.equal(last, 429);
  assert.equal((await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD }, ip: '8.8.8.8' })).status, 200);
});

test('đếm lần thử là nguyên tử: 25 yêu cầu song song cho đúng 25 lần đếm, không sót', async () => {
  const w = await world();
  await Promise.all(Array.from({ length: 25 }, () => w.call('/login', { body: { email: 'emp@x.vn', password: 'sai-sai-sai' }, ip: '7.7.7.7' })));
  const c = ((await w.d1.sqlite.prepare('SELECT count FROM staff_auth_attempts ORDER BY count DESC').all()) as any[]).map(r => r.count);
  assert.equal(c[0], 25);
});

test('phiên: hết hạn, tài khoản bị khoá, đổi phiên bản thông tin đăng nhập → 401', async () => {
  const w = await world();
  const expired = await w.login('emp@x.vn');
  (await w.d1.sqlite.prepare('UPDATE staff_sessions SET expires = ?').run(w.clock.t - 1));
  assert.equal((await w.call('/me', { cookie: expired.cookie })).body.error, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  const locked = await w.login('mgr@x.vn');
  assert.equal((await w.call('/me', { cookie: locked.cookie })).status, 200);
  (await w.d1.sqlite.prepare("UPDATE staff_members SET active=0 WHERE id='mgr'").run());
  assert.equal((await w.call('/me', { cookie: locked.cookie })).status, 401);
  (await w.d1.sqlite.prepare("UPDATE staff_members SET active=1 WHERE id='mgr'").run());
  assert.equal((await w.call('/me', { cookie: locked.cookie })).status, 200);
  (await w.d1.sqlite.prepare("UPDATE staff_credentials SET version=version+1 WHERE member_id='mgr'").run());
  assert.equal((await w.call('/me', { cookie: locked.cookie })).status, 401);
});

test('cookie thiếu / hỏng / token lạ: 401 đúng thông báo', async () => {
  const w = await world();
  assert.equal((await w.call('/me')).body.error, 'Vui lòng đăng nhập bằng email công ty.');
  assert.equal((await w.call('/me', { cookie: `${SESSION_COOKIE}=abc` })).body.error, 'Vui lòng đăng nhập bằng email công ty.');
  assert.equal((await w.call('/me', { cookie: `${SESSION_COOKIE}=${token(77)}` })).body.error, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  assert.equal((await w.call('/me', { cookie: `other=1; ${SESSION_COOKIE}=${token(77)}; x=2` })).status, 401);
});

test('token phiên không lưu thô trong DB (chỉ lưu băm)', async () => {
  const w = await world();
  const l = await w.login('emp@x.vn'); const raw = l.cookie.split('=')[1]!;
  const rows = (await w.d1.sqlite.prepare('SELECT hash FROM staff_sessions').all()) as any[];
  assert.equal(rows.length, 1); assert.notEqual(rows[0].hash, raw); assert.match(rows[0].hash, /^[a-f0-9]{64}$/);
});

test('đổi mật khẩu: sai mật khẩu hiện tại 400, quá ngắn 400; thành công thì mọi phiên bị huỷ và phải đăng nhập lại bằng mật khẩu mới', async () => {
  const w = await world();
  const a = await w.login('emp@x.vn'), b = await w.login('emp@x.vn');
  assert.equal((await w.call('/password', { body: { currentPassword: 'sai-sai-sai', password: 'mat-khau-moi-1' }, cookie: a.cookie })).body.error, 'Mật khẩu hiện tại không đúng.');
  assert.equal((await w.call('/password', { body: { currentPassword: PASSWORD, password: 'ngan' }, cookie: a.cookie })).status, 400);
  const ok = await w.call('/password', { body: { currentPassword: PASSWORD, password: 'mat-khau-moi-1' }, cookie: a.cookie });
  assert.equal(ok.status, 200); assert.match(ok.cookie!, /Max-Age=0/);
  for (const c of [a.cookie, b.cookie]) assert.equal((await w.call('/me', { cookie: c })).status, 401); // cả thiết bị khác cũng bị đăng xuất
  assert.equal((await w.login('emp@x.vn', PASSWORD)).status, 401);
  assert.equal((await w.login('emp@x.vn', 'mat-khau-moi-1')).status, 200);
});

test('chặn giả mạo yêu cầu (CSRF) và phương thức lạ', async () => {
  const w = await world();
  assert.equal((await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD }, origin: 'https://evil.test' })).body.error, 'Nguồn yêu cầu không hợp lệ.');
  assert.equal((await w.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD }, origin: null })).status, 403);
  assert.equal((await w.call('/me', { origin: 'https://evil.test' })).status, 401); // GET không cần Origin (chỉ cần phiên)
  assert.equal((await w.call('/me', { method: 'PATCH' })).body.error, 'Phương thức không hỗ trợ.');
  assert.equal((await w.call('/login', { raw: '{bad', type: 'application/json' })).body.error, 'Nội dung không hợp lệ.');
  assert.equal((await w.call('/login', { raw: '[]' })).body.error, 'Nội dung không hợp lệ.');
  assert.equal((await w.call('/login', { raw: '{}', type: 'text/plain' })).status, 415);
});

test('KHU VỰC: NCC chỉ vào self + cổng NCC; nhân viên không vào cổng NCC; chỉ Manager vào quản lý NCC; không đăng nhập thì 401', async () => {
  const w = await world();
  const ncc = await w.login('ncc@x.vn'), emp = await w.login('emp@x.vn'), mgr = await w.login('mgr@x.vn');
  const code = async (path: string, cookie: string) => (await w.call(path, { cookie })).status;
  assert.deepEqual([await code('/me', ncc.cookie), await code('/portal', ncc.cookie), await code('/biz', ncc.cookie), await code('/ncc-admin', ncc.cookie)], [200, 200, 403, 403]);
  assert.equal((await w.call('/biz', { cookie: ncc.cookie })).body.error, 'Tài khoản NCC chỉ được xem đơn hàng NCC đã duyệt.');
  assert.deepEqual([await code('/me', emp.cookie), await code('/portal', emp.cookie), await code('/biz', emp.cookie), await code('/ncc-admin', emp.cookie)], [200, 403, 200, 403]);
  assert.deepEqual([await code('/me', mgr.cookie), await code('/portal', mgr.cookie), await code('/biz', mgr.cookie), await code('/ncc-admin', mgr.cookie)], [200, 200, 200, 200]);
  for (const p of ['/me', '/biz', '/portal', '/ncc-admin']) assert.equal((await w.call(p)).status, 401, p);
});

test('NCC lệch vai trò (vai trò nhân viên nhưng chức vụ NCC) vẫn bị giới hạn như NCC', async () => {
  const w = await world();
  (await w.d1.sqlite.prepare("UPDATE staff_members SET role='employee' WHERE id='ncc'").run());
  const l = await w.login('ncc@x.vn');
  assert.equal((await w.call('/biz', { cookie: l.cookie })).status, 403);
  assert.equal((await w.call('/portal', { cookie: l.cookie })).status, 200);
});

test('phiên trượt: còn dùng thì tự gia hạn 30 ngày (tối đa 1 lần/ngày); bỏ không dùng quá 30 ngày mới hết hạn', async () => {
  const { login, call, clock } = await world();
  const DAY = 86_400, { cookie } = await login('emp@x.vn');
  // Dùng đều đặn mỗi 20 ngày trong 100 ngày: không bao giờ bị đá ra.
  for (let i = 0; i < 5; i++) { clock.t += 20 * DAY; assert.equal((await call('/me', { cookie })).status, 200, `ngày ${(i + 1) * 20}`); }
  // Bỏ app 31 ngày: phiên hết hạn.
  clock.t += 31 * DAY;
  assert.equal((await call('/me', { cookie })).status, 401);
});

test('phiên trượt: lần gia hạn gửi lại cookie cùng token với Max-Age 30 ngày mới (cookie trình duyệt trượt theo phiên)', async () => {
  const { login, call, clock } = await world();
  const DAY = 86_400, { cookie } = await login('emp@x.vn');
  assert.equal((await call('/me', { cookie })).cookie, null, 'chưa tới lúc gia hạn: không gửi cookie');
  clock.t += 2 * DAY;
  assert.equal((await call('/me', { cookie })).cookie, `${cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);
  assert.equal((await call('/me', { cookie })).cookie, null, 'tối đa 1 lần/ngày');
  clock.t += 2 * DAY;
  const out = await call('/logout', { body: {}, cookie });
  assert.match(out.cookie!, /Max-Age=0$/, 'đăng xuất đúng lúc gia hạn: vẫn xoá cookie');
});

test('gia hạn phiên chỉ khi đã trôi qua hơn 1 ngày từ lần gia hạn trước (không ghi DB mỗi request)', () => {
  const now = 1_000_000;
  assert.equal(shouldRenewSession(now + SESSION_LIFETIME_SECONDS, now), false);
  assert.equal(shouldRenewSession(now + SESSION_LIFETIME_SECONDS - 3600, now), false);
  assert.equal(shouldRenewSession(now + SESSION_LIFETIME_SECONDS - 86_401, now), true);
});
