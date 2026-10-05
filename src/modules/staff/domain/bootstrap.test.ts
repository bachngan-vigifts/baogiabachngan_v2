/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestDb } from '../../../../tests/helpers/d1.ts';
import { createStaffRouter, type StaffEnv } from '../api/auth-routes.ts';
import { buildManagerBootstrap, sqlLiteral } from './bootstrap.ts';
import { sha256Hex } from './session.ts';

const O = 'https://staff.test';
const root = join(import.meta.dirname, '..', '..', '..', '..');

test('SQL chèn dữ liệu đúng và an toàn với dấu nháy trong tên (không bị chèn SQL)', () => {
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  const { db, d1 } = createTestDb(); void db;
  const r = buildManagerBootstrap({ name: "Trần O'Neil'); DROP TABLE staff_members;--", email: ' Gd@X.vn ', phone: '0900', origin: O, nowSec: 1_800_000_000, token: 'b'.repeat(64), id: 'NV-test' });
  for (const s of r.sql) d1.sqlite.exec(s);
  const m = d1.sqlite.prepare("SELECT name,email,role,position_id,active FROM staff_members WHERE id='NV-test'").get() as any;
  assert.deepEqual({ ...m }, { name: "Trần O'Neil'); DROP TABLE staff_members;--", email: 'gd@x.vn', role: 'manager', position_id: 'manager', active: 1 });
  const c = d1.sqlite.prepare("SELECT activation_hash h, activation_expires e, version v, password_hash p FROM staff_credentials WHERE member_id='NV-test'").get() as any;
  assert.deepEqual({ ...c }, { h: sha256Hex('b'.repeat(64)), e: 1_800_000_000 + 86400, v: 0, p: null }); // chỉ lưu BĂM của token, hiệu lực 24 giờ
  assert.ok(!r.sql.join('\n').includes('b'.repeat(64))); // token thô không nằm trong SQL
});

test('dữ liệu vào không hợp lệ bị từ chối', () => {
  const ok = { name: 'A', email: 'a@x.vn', phone: '1', origin: O, nowSec: 1 };
  for (const bad of [{ name: ' ' }, { email: 'sai' }, { phone: '' }, { phone: '9'.repeat(41) }, { name: 'x'.repeat(201) }])
    assert.throws(() => buildManagerBootstrap({ ...ok, ...bad }), /Cần họ tên/);
});

test('CHẠY THẬT script: SQL áp lên DB, liên kết in ra kích hoạt được rồi đăng nhập với vai trò Manager', async () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/bootstrap-manager.ts'), '--name', 'Giám Đốc', '--email', 'GD@Cong-Ty.vn', '--phone', '0900000000', '--origin', O], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const link = /(https:\/\/\S+login\.html#\S+)/.exec(run.stderr)?.[1] ?? '';
  const token = /token=([a-f0-9]{64})/.exec(link)?.[1];
  assert.ok(token, 'script phải in liên kết kích hoạt ra STDERR');
  assert.ok(!run.stdout.includes(token!), 'STDOUT (file SQL) không được chứa token thô');
  assert.ok(link.includes('email=gd%40cong-ty.vn'));

  const { db, d1 } = createTestDb();
  d1.sqlite.exec(run.stdout);
  const env: StaffEnv = { db, passwordIterations: 1000 };
  const router = createStaffRouter();
  const call = async (path: string, body: object, cookie = '') => { const r = await router.handle(new Request(O + '/api/staff' + path, { method: 'POST', headers: { origin: O, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }), env); return { status: r.status, body: await r.json() as any, cookie: r.headers.get('set-cookie') }; };
  assert.equal((await call('/activate', { token, password: 'mat-khau-giam-doc' })).status, 200);
  const l = await call('/login', { email: 'gd@cong-ty.vn', password: 'mat-khau-giam-doc' });
  assert.equal(l.status, 200);
  assert.equal(l.body.user.role, 'manager');
  assert.equal(l.body.user.position, 'Manager');
  // Manager vừa tạo vào được trang quản lý nhân viên
  const list = await router.handle(new Request(O + '/api/staff/admin/members', { headers: { cookie: l.cookie!.split(';')[0]! } }), env);
  assert.equal(list.status, 200);
});

test('script từ chối khi thiếu hoặc sai tham số, và origin phải là https', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/bootstrap-manager.ts'), ...a], { cwd: root, encoding: 'utf8' });
  assert.notEqual(run('--name', 'A', '--email', 'sai', '--phone', '1', '--origin', O).status, 0);
  assert.notEqual(run('--name', 'A', '--email', 'a@x.vn', '--phone', '1', '--origin', 'http://khong-bao-mat.vn').status, 0);
  assert.notEqual(run().status, 0);
});
