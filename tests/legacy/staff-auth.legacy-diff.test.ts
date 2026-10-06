/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailable, skipReason, loadLegacyStaffApi, legacyMigrationsDir } from './harness.ts';
import { PASSWORD, token, T } from '../helpers/staff-fixture.ts';
import { sha256Hex } from '../../src/modules/staff/domain/session.ts';
import { legacyDriver as legacyDriverBase, newDriver, cookieOf, login, type Driver } from './staff-driver.ts';

const staffApi = legacyAvailable ? await loadLegacyStaffApi() : null;
const opts = { skip: skipReason, timeout: 120000 };
const legacyDriver = () => legacyDriverBase(staffApi!);
/** Quan sát được: mã, nội dung, cookie (che token), cộng với trạng thái DB cuối kịch bản. */
const mask = (s: string | null) => s && s.replace(/[a-f0-9]{64}/g, '<TOKEN>');
async function observe(d: Driver, steps: (rec: (label: string, p: Promise<any>) => Promise<any>, d: Driver) => Promise<void>) {
  const log: any[] = [];
  const rec = async (label: string, p: Promise<any>) => { const r = await p; log.push({ label, status: r.status, body: r.body, cookie: mask(r.cookie) }); return r; };
  await steps(rec, d);
  const q = d.d1.sqlite;
  log.push({ label: 'DB', attempts: (await q.prepare('SELECT key, count FROM staff_auth_attempts ORDER BY key').all()).map(r => ({ ...r })),
    sessions: (await q.prepare('SELECT member_id, COUNT(*) n FROM staff_sessions GROUP BY member_id ORDER BY member_id').all()).map(r => ({ ...r })),
    creds: (await q.prepare('SELECT member_id, version, password_hash IS NOT NULL pw, activation_hash IS NOT NULL act FROM staff_credentials ORDER BY member_id').all()).map(r => ({ ...r })) });
  return log;
}

async function compare(name: string, steps: Parameters<typeof observe>[1]) {
  const [legacy, mine] = [await observe(await legacyDriver(), steps), await observe(await newDriver(), steps)];
  assert.equal(mine.length, legacy.length);
  for (let i = 0; i < legacy.length; i++) assert.deepStrictEqual(mine[i], legacy[i], `[${name}] bước "${legacy[i].label}"`);
  return legacy;
}

test('KÍCH HOẠT ↔ bản cũ: xem liên kết, mật khẩu yếu, kích hoạt, dùng lại liên kết, đăng nhập bằng mật khẩu mới', opts, async () => {
  await compare('kích hoạt', async (rec, d) => {
    await rec('info: sai định dạng', d.call('/activation-info', { body: { token: 'abc' } }));
    await rec('info: không có token', d.call('/activation-info', { body: {} }));
    await rec('info: token lạ', d.call('/activation-info', { body: { token: token(99) } }));
    await rec('info: liên kết hết hạn', d.call('/activation-info', { body: { token: token(2) } }));
    await rec('info: hợp lệ', d.call('/activation-info', { body: { token: token(1) } }));
    await rec('activate: mật khẩu ngắn', d.call('/activate', { body: { token: token(1), password: 'ngan' } }));
    await rec('activate: không có mật khẩu', d.call('/activate', { body: { token: token(1) } }));
    await rec('activate: hết hạn', d.call('/activate', { body: { token: token(2), password: PASSWORD } }));
    await rec('activate: hợp lệ', d.call('/activate', { body: { token: token(1), password: PASSWORD } }));
    await rec('activate: dùng lại', d.call('/activate', { body: { token: token(1), password: PASSWORD } }));
    await rec('info: sau khi dùng', d.call('/activation-info', { body: { token: token(1) } }));
    await rec('login mật khẩu mới', login(d, 'new@x.vn'));
  });
});

test('ĐĂNG NHẬP ↔ bản cũ: mọi kiểu thất bại và thành công, chuẩn hoá email, thân yêu cầu hỏng', opts, async () => {
  await compare('đăng nhập', async (rec, d) => {
    await rec('thành công', login(d, 'emp@x.vn'));
    await rec('email hoa + khoảng trắng', login(d, '  EMP@X.vn '));
    await rec('sai mật khẩu', login(d, 'emp@x.vn', 'sai-sai-sai'));
    await rec('thiếu mật khẩu', login(d, 'emp@x.vn', undefined));
    await rec('mật khẩu số', login(d, 'emp@x.vn', 12345678));
    await rec('mật khẩu quá dài', login(d, 'emp@x.vn', 'x'.repeat(129)));
    await rec('tài khoản bị khoá', login(d, 'off@x.vn'));
    await rec('chưa kích hoạt', login(d, 'new@x.vn'));
    await rec('email lạ', login(d, 'khong-co@x.vn'));
    await rec('thân rỗng', d.call('/login', { body: {} }));
    await rec('JSON hỏng', d.call('/login', { raw: '{bad' }));
    await rec('JSON là mảng', d.call('/login', { raw: '[]' }));
    await rec('sai Content-Type', d.call('/login', { raw: '{}', type: 'text/plain' }));
    await rec('thiếu Content-Type', d.call('/login', { raw: '{}', type: null }));
    await rec('thân quá lớn', d.call('/login', { raw: JSON.stringify({ email: 'a', password: 'x'.repeat(5000) }) }));
    await rec('NCC đăng nhập', login(d, 'ncc@x.vn'));
    await rec('Manager đăng nhập', login(d, 'mgr@x.vn'));
  });
});

test('GIỚI HẠN THỬ ↔ bản cũ: cùng ngưỡng 10 lần/email, chặn cả khi đúng mật khẩu, 100 lần/IP, khoá đếm giống hệt trong DB', opts, async () => {
  await compare('giới hạn email', async (rec, d) => {
    for (let i = 1; i <= 12; i++) await rec(`sai lần ${i}`, login(d, 'emp@x.vn', 'sai-sai-sai'));
    await rec('đúng mật khẩu nhưng đã bị chặn', login(d, 'emp@x.vn'));
    await rec('email khác vẫn vào được', login(d, 'mgr@x.vn'));
  });
  await compare('giới hạn IP', async (rec, d) => {
    const key = sha256Hex('ip:unknown');
    (await d.d1.sqlite.prepare('INSERT INTO staff_auth_attempts (key,count,expires) VALUES (?,99,?)').run(key, T.now + 900)); // đã dùng 99/100
    await rec('lần 100', login(d, 'emp@x.vn'));
    await rec('lần 101', login(d, 'mgr@x.vn'));
    await rec('IP khác', login(d, 'mgr@x.vn', PASSWORD, '5.5.5.5'));
  });
  await compare('hết cửa sổ đếm', async (rec, d) => {
    (await d.d1.sqlite.prepare('INSERT INTO staff_auth_attempts (key,count,expires) VALUES (?,50,?)').run(sha256Hex('email:emp@x.vn'), T.now - 5)); // đã hết hạn
    await rec('đếm lại từ đầu', login(d, 'emp@x.vn', 'sai-sai-sai'));
  });
});

test('PHIÊN ↔ bản cũ: /me, hết hạn, khoá tài khoản, đổi phiên bản, cookie hỏng, đăng xuất', opts, async () => {
  await compare('phiên', async (rec, d) => {
    await rec('/me không cookie', d.call('/me'));
    await rec('/me cookie ngắn', d.call('/me', { cookie: '__Host-bn-session=abc' }));
    await rec('/me token lạ', d.call('/me', { cookie: `__Host-bn-session=${token(77)}` }));
    const emp = cookieOf(await rec('login emp', login(d, 'emp@x.vn')));
    await rec('/me ok', d.call('/me', { cookie: emp }));
    await rec('/me cookie lẫn cookie khác', d.call('/me', { cookie: `a=1; ${emp}; b=2` }));
    (await d.d1.sqlite.prepare("UPDATE staff_sessions SET expires = ? WHERE member_id='emp'").run(T.now - 1));
    await rec('/me hết hạn', d.call('/me', { cookie: emp }));
    const mgr = cookieOf(await rec('login mgr', login(d, 'mgr@x.vn')));
    (await d.d1.sqlite.prepare("UPDATE staff_members SET active=0 WHERE id='mgr'").run());
    await rec('/me bị khoá', d.call('/me', { cookie: mgr }));
    (await d.d1.sqlite.prepare("UPDATE staff_members SET active=1 WHERE id='mgr'").run());
    await rec('/me mở khoá lại', d.call('/me', { cookie: mgr }));
    (await d.d1.sqlite.prepare("UPDATE staff_credentials SET version=version+1 WHERE member_id='mgr'").run());
    await rec('/me đổi phiên bản', d.call('/me', { cookie: mgr }));
    const emp2 = cookieOf(await rec('login emp lần 2', login(d, 'emp@x.vn')));
    await rec('logout', d.call('/logout', { body: {}, cookie: emp2 }));
    await rec('/me sau logout', d.call('/me', { cookie: emp2 }));
    await rec('logout không phiên', d.call('/logout', { body: {} }));
  });
});

test('ĐỔI MẬT KHẨU ↔ bản cũ: sai mật khẩu hiện tại, quá ngắn, thành công huỷ mọi phiên, mật khẩu cũ hết dùng, giới hạn thử', opts, async () => {
  await compare('đổi mật khẩu', async (rec, d) => {
    const a = cookieOf(await rec('login a', login(d, 'emp@x.vn')));
    const b = cookieOf(await rec('login b', login(d, 'emp@x.vn')));
    await rec('không phiên', d.call('/password', { body: { currentPassword: PASSWORD, password: 'mat-khau-moi-1' } }));
    await rec('sai mật khẩu hiện tại', d.call('/password', { body: { currentPassword: 'sai-sai-sai', password: 'mat-khau-moi-1' }, cookie: a }));
    await rec('thiếu mật khẩu hiện tại', d.call('/password', { body: { password: 'mat-khau-moi-1' }, cookie: a }));
    await rec('mật khẩu mới quá ngắn', d.call('/password', { body: { currentPassword: PASSWORD, password: 'ngan' }, cookie: a }));
    await rec('thành công', d.call('/password', { body: { currentPassword: PASSWORD, password: 'mat-khau-moi-1' }, cookie: a }));
    await rec('phiên a sau đổi', d.call('/me', { cookie: a }));
    await rec('phiên b sau đổi', d.call('/me', { cookie: b }));
    await rec('đăng nhập mật khẩu cũ', login(d, 'emp@x.vn', PASSWORD));
    await rec('đăng nhập mật khẩu mới', login(d, 'emp@x.vn', 'mat-khau-moi-1'));
  });
  await compare('giới hạn đổi mật khẩu', async (rec, d) => {
    const a = cookieOf(await rec('login', login(d, 'emp@x.vn')));
    for (let i = 1; i <= 11; i++) await rec(`sai lần ${i}`, d.call('/password', { body: { currentPassword: 'sai-sai-sai', password: 'mat-khau-moi-1' }, cookie: a }));
  });
});

test('NGUỒN YÊU CẦU & PHƯƠNG THỨC ↔ bản cũ: chặn Origin lạ, thiếu Origin, phương thức không hỗ trợ', opts, async () => {
  await compare('origin', async (rec, d) => {
    await rec('POST origin lạ', d.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD }, origin: 'https://evil.test' }));
    await rec('POST thiếu origin', d.call('/login', { body: { email: 'emp@x.vn', password: PASSWORD }, origin: null }));
    const c = cookieOf(await rec('login', login(d, 'emp@x.vn')));
    await rec('logout origin lạ', d.call('/logout', { body: {}, cookie: c, origin: 'https://evil.test' }));
    await rec('GET /me origin lạ vẫn được', d.call('/me', { cookie: c, origin: 'https://evil.test' }));
    await rec('PATCH', d.call('/me', { method: 'PATCH', cookie: c }));
    await rec('OPTIONS', d.call('/me', { method: 'OPTIONS' }));
    await rec('HEAD', d.call('/me', { method: 'HEAD' }).catch(() => ({ status: -1, body: null, cookie: null })));
  });
});

test('KHU VỰC NCC ↔ bản cũ: NCC dùng được /me, /logout, /password; vào route nghiệp vụ nhận đúng 403 và thông báo', opts, async () => {
  await compare('NCC', async (rec, d) => {
    const ncc = cookieOf(await rec('login NCC', login(d, 'ncc@x.vn')));
    await rec('/me', d.call('/me', { cookie: ncc }));
    await rec('route nghiệp vụ /customers', d.call('/customers', { cookie: ncc }));
    await rec('đổi mật khẩu sai', d.call('/password', { body: { currentPassword: 'sai-sai-sai', password: 'mat-khau-moi-1' }, cookie: ncc }));
    await rec('logout', d.call('/logout', { body: {}, cookie: ncc }));
    await rec('/me sau logout', d.call('/me', { cookie: ncc }));
  });
});
