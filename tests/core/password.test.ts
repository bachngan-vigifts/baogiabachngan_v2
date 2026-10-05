import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../src/core/auth/password.ts';
import { AppError } from '../../src/core/errors.ts';

test('hash mới đúng chuẩn PBKDF2-SHA256 và đúng định dạng bản cũ', async () => {
  const stored = await hashPassword('12345678', 1000);
  const [scheme, iter, salt, hash] = stored.split('$');
  assert.equal(scheme, 'pbkdf2-sha256'); assert.equal(iter, '1000');
  assert.equal(hash, pbkdf2Sync('12345678', salt!, 1000, 32, 'sha256').toString('hex'));
  assert.equal(await verifyPassword('12345678', stored), true);
  assert.equal(await verifyPassword('87654321', stored), false);
});

test('mật khẩu đã lưu trong DB bản cũ (600.000 vòng) đăng nhập được với code mới', async () => {
  const salt = randomBytes(16).toString('hex'); // bản cũ băm theo chuỗi hex của salt
  const legacy = `pbkdf2-sha256$600000$${salt}$${pbkdf2Sync('mat-khau-cu-123', salt, 600000, 32, 'sha256').toString('hex')}`;
  assert.equal(await verifyPassword('mat-khau-cu-123', legacy), true);
  assert.equal(await verifyPassword('sai-mat-khau', legacy), false);
});

test('hai lần băm cùng mật khẩu cho salt khác nhau', async () => {
  assert.notEqual(await hashPassword('12345678', 1000), await hashPassword('12345678', 1000));
});

test('giới hạn độ dài: 8..128 khi tạo; > 128 không bao giờ khớp', async () => {
  await assert.rejects(hashPassword('1234567'), (e: AppError) => e.status === 400);
  await assert.rejects(hashPassword('x'.repeat(129)), (e: AppError) => e.status === 400);
  await assert.rejects(hashPassword(undefined), (e: AppError) => e.status === 400);
  assert.equal(await verifyPassword('x'.repeat(129), await hashPassword('12345678', 1000)), false);
});

test('chưa có hash hoặc hash hỏng/đáng ngờ thì luôn false (không ném lỗi)', async () => {
  for (const bad of [null, undefined, '', 'rac', 'md5$1$a$b', 'pbkdf2-sha256$0$aa$bb', 'pbkdf2-sha256$99999999$aa$bb', 'pbkdf2-sha256$1000$$'])
    assert.equal(await verifyPassword('12345678', bad as string), false, String(bad));
  assert.equal(await verifyPassword(12345678, await hashPassword('12345678', 1000)), false);
});
