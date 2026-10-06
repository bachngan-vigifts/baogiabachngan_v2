/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailable, skipReason, loadLegacyStaffApi } from './harness.ts';
import { PASSWORD, T } from '../helpers/staff-fixture.ts';
import { legacyDriver as legacyDriverBase, newDriver, cookieOf, login, maskRandom, tokenFromUrl, type Driver, type Result } from './staff-driver.ts';

const staffApi = legacyAvailable ? await loadLegacyStaffApi() : null;
const opts = { skip: skipReason, timeout: 120000 };

/** Quan sát được: mã, nội dung (che id/token ngẫu nhiên), cookie, cộng trạng thái DB cuối kịch bản. */
async function observe(d: Driver, steps: (rec: (label: string, p: Promise<Result>) => Promise<Result>, d: Driver) => Promise<void>) {
  const log: any[] = [];
  const ttl = (b: any) => b && typeof b.expiresAt === 'number' ? { ...b, expiresAt: `còn ~${Math.round((b.expiresAt / 1000 - Date.now() / 1000) / 10) * 10}s` } : b; // hai bản chạy lệch vài giây
  const rec = async (label: string, p: Promise<Result>) => { const r = await p; log.push({ label, status: r.status, body: maskRandom(ttl(r.body)), cookie: r.cookie && maskRandom(r.cookie) }); return r; };
  await steps(rec, d);
  const q = d.d1.sqlite;
  log.push({ label: 'DB',
    members: (await q.prepare('SELECT email, name, phone, role, position_id, active FROM staff_members ORDER BY email').all()).map(r => ({ ...r })),
    creds: (await q.prepare('SELECT m.email, c.version, c.password_hash IS NOT NULL pw, c.activation_hash IS NOT NULL act FROM staff_credentials c JOIN staff_members m ON m.id=c.member_id ORDER BY m.email').all()).map(r => ({ ...r })),
    sessions: (await q.prepare('SELECT m.email, COUNT(*) n FROM staff_sessions s JOIN staff_members m ON m.id=s.member_id GROUP BY m.email ORDER BY m.email').all()).map(r => ({ ...r })) });
  return log;
}
async function compare(name: string, steps: Parameters<typeof observe>[1]) {
  const legacy = await observe(await legacyDriverBase(staffApi!), steps), mine = await observe(await newDriver(), steps);
  assert.equal(mine.length, legacy.length);
  for (let i = 0; i < legacy.length; i++) assert.deepStrictEqual(mine[i], legacy[i], `[${name}] bước "${legacy[i].label}"`);
}
const as = async (d: Driver, email: string) => cookieOf(await login(d, email));
const post = (d: Driver, path: string, body: unknown, cookie: string, method = 'POST') => d.call(path, { method, body, cookie });
const goodNew = { name: 'Nguyễn Văn A', email: 'a.moi@x.vn', phone: '0911111111', positionId: 'sale' };

test('DANH SÁCH NHÂN VIÊN ↔ bản cũ: cùng dữ liệu, cờ đã kích hoạt, danh sách chức vụ theo tên', opts, async () => {
  await compare('danh sách', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn');
    await rec('GET danh sách', d.call('/admin/members', { cookie: m }));
  });
});

test('TẠO NHÂN VIÊN ↔ bản cũ: mọi lỗi nhập liệu, trùng email, vai trò suy từ chức vụ, liên kết kích hoạt dùng được', opts, async () => {
  await compare('tạo', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn'), create = (b: object) => rec(`tạo ${JSON.stringify(b).slice(0, 60)}`, post(d, '/admin/members', b, m));
    await create({ ...goodNew, phone: undefined });
    await create({ ...goodNew, phone: '   ' });
    await create({ ...goodNew, phone: '9'.repeat(41) });
    await create({ ...goodNew, name: '  ' });
    await create({ ...goodNew, name: 'x'.repeat(201) });
    await create({ ...goodNew, email: 'khong-hop-le' });
    await create({ ...goodNew, email: 'a'.repeat(250) + '@x.vn' });
    await create({ ...goodNew, email: 123 });
    await create({ ...goodNew, positionId: undefined });
    await create({ ...goodNew, positionId: 'khong-co' });
    await create({ ...goodNew, email: 'EMP@x.vn' });          // trùng email (khác hoa/thường)
    await create({ ...goodNew, email: '  Mgr@X.vn ' });       // trùng email sau khi chuẩn hoá
    const ok = await create(goodNew);
    await create({ ...goodNew, email: 'quan.ly@x.vn', positionId: 'manager' });
    await create({ ...goodNew, email: 'ncc.moi@x.vn', positionId: 'supplier' });
    await create({ ...goodNew, email: 'kho@x.vn', positionId: 'warehouse', role: 'manager' } as object); // role client gửi bị bỏ qua
    // liên kết kích hoạt: kích hoạt rồi đăng nhập
    const t = tokenFromUrl(ok);
    await rec('info liên kết mới', d.call('/activation-info', { body: { token: t } }));
    await rec('kích hoạt', d.call('/activate', { body: { token: t, password: PASSWORD } }));
    const l = await rec('đăng nhập nhân viên mới', login(d, 'a.moi@x.vn'));
    await rec('/me nhân viên mới', d.call('/me', { cookie: cookieOf(l) }));
    // hiệu lực liên kết 15 phút
    (await d.d1.sqlite.prepare("UPDATE staff_credentials SET activation_hash=?, activation_expires=? WHERE member_id IN (SELECT id FROM staff_members WHERE email='ncc.moi@x.vn')").run('0'.repeat(64), T.now + 899));
  });
});

test('SỬA NHÂN VIÊN ↔ bản cũ: tự sửa, hồ sơ đã hợp nhất, mọi lỗi nhập liệu, vai trò suy từ chức vụ, huỷ phiên của người bị sửa', opts, async () => {
  await compare('sửa', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn');
    const id = async (email: string) => ((await d.d1.sqlite.prepare('SELECT id FROM staff_members WHERE email=?').get(email)) as any).id as string;
    const emp = (await id('emp@x.vn')), mgr = (await id('mgr@x.vn'));
    const base = { id: await emp, name: 'Tên mới', email: 'emp@x.vn', phone: '0922222222', role: 'employee', positionId: 'sale', active: true };
    const put = (label: string, b: object) => rec(label, post(d, '/admin/member', b, m, 'PUT'));
    await put('tự sửa', { ...base, id: await mgr });
    (await d.d1.sqlite.prepare("INSERT INTO staff_sapo_links (sapo_id, member_id, created_at, evidence) VALUES ('SAPO-1', ?, '2026-01-01T00:00:00.000Z', 'test')").run(await emp));
    await put('hồ sơ đã hợp nhất (id Sapo)', { ...base, id: 'SAPO-1' });
    await put('role lạ', { ...base, role: 'admin' });
    await put('active không phải boolean', { ...base, active: 'true' });
    await put('tên rỗng', { ...base, name: ' ' });
    await put('email sai', { ...base, email: 'sai' });
    await put('thiếu điện thoại', { ...base, phone: '' });
    await put('điện thoại quá dài', { ...base, phone: '9'.repeat(41) });
    await put('chức vụ lạ', { ...base, positionId: 'khong-co' });
    await put('trùng email người khác', { ...base, email: 'MGR@x.vn' });
    await put('id không tồn tại', { ...base, id: 'NV-khong-co' });
    const sess = cookieOf(await login(d, 'emp@x.vn'));
    await rec('/me trước khi sửa', d.call('/me', { cookie: sess }));
    await put('sửa thành công (role gửi lên bị bỏ qua)', { ...base, role: 'manager', name: 'Tên sau sửa', email: 'EMP.Moi@x.vn' });
    await rec('/me sau khi sửa (phiên bị huỷ)', d.call('/me', { cookie: sess }));
    await put('đổi chức vụ sang Manager', { ...base, email: 'emp.moi@x.vn', positionId: 'manager', role: 'employee' });
    await put('khoá tài khoản', { ...base, email: 'emp.moi@x.vn', positionId: 'sale', active: false });
    await rec('khoá rồi không đăng nhập được', login(d, 'emp.moi@x.vn'));
  });
});

test('KHOÁ (XOÁ) NHÂN VIÊN ↔ bản cũ: không tự xoá, không tìm thấy, huỷ phiên, không đăng nhập lại được', opts, async () => {
  await compare('khoá', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn');
    const id = async (email: string) => ((await d.d1.sqlite.prepare('SELECT id FROM staff_members WHERE email=?').get(email)) as any).id as string;
    const del = (label: string, b: object) => rec(label, post(d, '/admin/member', b, m, 'DELETE'));
    await del('tự xoá', { id: (await id('mgr@x.vn')) });
    await del('id không tồn tại', { id: 'NV-khong-co' });
    const sess = cookieOf(await login(d, 'emp@x.vn'));
    await del('xoá thành công', { id: (await id('emp@x.vn')) });
    await rec('phiên của người bị khoá', d.call('/me', { cookie: sess }));
    await rec('đăng nhập lại', login(d, 'emp@x.vn'));
    await del('xoá lần hai (đã khoá)', { id: (await id('emp@x.vn')) });
    await rec('danh sách sau khi khoá', d.call('/admin/members', { cookie: m }));
  });
});

test('CẤP LẠI LIÊN KẾT ↔ bản cũ: không tự đặt lại, không tìm thấy/đã khoá, huỷ mật khẩu + phiên, liên kết dùng được', opts, async () => {
  await compare('đặt lại', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn');
    const id = async (email: string) => ((await d.d1.sqlite.prepare('SELECT id FROM staff_members WHERE email=?').get(email)) as any).id as string;
    const reset = (label: string, b: object) => rec(label, post(d, '/admin/reset', b, m));
    await reset('tự đặt lại', { id: (await id('mgr@x.vn')) });
    await reset('không tồn tại', { id: 'NV-khong-co' });
    await reset('tài khoản đã khoá', { id: (await id('off@x.vn')) });
    const sess = cookieOf(await login(d, 'emp@x.vn'));
    const r = await reset('thành công', { id: (await id('emp@x.vn')) });
    await rec('phiên cũ bị huỷ', d.call('/me', { cookie: sess }));
    await rec('mật khẩu cũ hết dùng', login(d, 'emp@x.vn'));
    const t = tokenFromUrl(r);
    await rec('kích hoạt bằng liên kết mới', d.call('/activate', { body: { token: t, password: 'mat-khau-moi-2' } }));
    await rec('đăng nhập mật khẩu mới', login(d, 'emp@x.vn', 'mat-khau-moi-2'));
    await reset('đặt lại lần hai (liên kết cũ thay thế)', { id: (await id('emp@x.vn')) });
    await rec('liên kết thứ nhất hết hiệu lực', d.call('/activation-info', { body: { token: t } }));
  });
});

test('ĐỔI SỐ ĐIỆN THOẠI ↔ bản cũ', opts, async () => {
  await compare('điện thoại', async (rec, d) => {
    const m = await as(d, 'mgr@x.vn');
    const id = async (email: string) => ((await d.d1.sqlite.prepare('SELECT id FROM staff_members WHERE email=?').get(email)) as any).id as string;
    const phone = (label: string, b: object) => rec(label, post(d, '/admin/member-phone', b, m, 'PUT'));
    await phone('hợp lệ', { id: (await id('emp@x.vn')), phone: '  0933333333 ' });
    await phone('rỗng (được phép)', { id: (await id('emp@x.vn')), phone: '' });
    await phone('quá dài', { id: (await id('emp@x.vn')), phone: '9'.repeat(41) });
    await phone('không phải chuỗi', { id: (await id('emp@x.vn')), phone: 123 });
    await phone('không tồn tại', { id: 'NV-khong-co', phone: '0900' });
  });
});

test('QUYỀN ↔ bản cũ: nhân viên, NCC và người chưa đăng nhập đều bị chặn mọi route quản lý nhân viên, đúng mã và thông báo', opts, async () => {
  await compare('quyền', async (rec, d) => {
    const emp = await as(d, 'emp@x.vn'), ncc = await as(d, 'ncc@x.vn');
    const routes: [string, string, unknown][] = [['GET', '/admin/members', undefined], ['POST', '/admin/members', goodNew], ['PUT', '/admin/member', {}], ['DELETE', '/admin/member', { id: 'x' }], ['POST', '/admin/reset', { id: 'x' }], ['PUT', '/admin/member-phone', { id: 'x', phone: '1' }]];
    for (const [method, path, body] of routes) {
      for (const [who, cookie] of [['nhân viên', emp], ['NCC', ncc], ['ẩn danh', '']] as const)
        await rec(`${who} ${method} ${path}`, d.call(path, { method, body, cookie }));
    }
  });
});

test('KHÁC BIỆT CÓ CHỦ ĐÍCH: thiếu `id` trong yêu cầu – bản cũ trả lỗi 500 (D1 từ chối giá trị undefined), bản mới trả 404 đúng nghĩa', opts, async () => {
  const run = async (d: Driver) => {
    const m = await as(d, 'mgr@x.vn'), out: Record<string, number> = {};
    out.xoa = (await post(d, '/admin/member', {}, m, 'DELETE')).status;
    out.datLai = (await post(d, '/admin/reset', {}, m)).status;
    out.dienThoai = (await post(d, '/admin/member-phone', { phone: '0900' }, m, 'PUT')).status;
    return out;
  };
  const legacy = await run(await legacyDriverBase(staffApi!)), mine = await run(await newDriver());
  assert.deepEqual(legacy, { xoa: 500, datLai: 500, dienThoai: 500 }); // bản cũ: lỗi hệ thống che mất lỗi nhập liệu
  assert.deepEqual(mine, { xoa: 404, datLai: 404, dienThoai: 404 });
});
