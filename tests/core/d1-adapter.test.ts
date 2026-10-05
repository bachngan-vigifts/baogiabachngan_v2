import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/d1.ts';
import { positions } from '../../src/modules/staff/schema.ts';

import { like } from 'drizzle-orm';
const mine = (db: ReturnType<typeof createTestDb>['db']) => db.select().from(positions).where(like(positions.id, 'zz-%'));

test('bộ chuyển đổi D1: chèn/đọc/cập nhật qua Drizzle D1 như production; boolean và tham số undefined', async () => {
  const { db, d1 } = createTestDb();
  await db.insert(positions).values({ id: 'zz-sale', name: 'ZZ Sale' });
  assert.deepEqual(await mine(db), [{ id: 'zz-sale', name: 'ZZ Sale' }]);
  const res = await db.update(positions).set({ name: 'Bán hàng' }).where(eq(positions.id, 'zz-sale')).run();
  assert.equal(res.meta.changes, 1);
  assert.equal((await db.update(positions).set({ name: 'x' }).where(eq(positions.id, 'khong-co')).run()).meta.changes, 0);
  assert.throws(() => d1.prepare('SELECT ?').bind(undefined), /undefined/);
});

test('bộ chuyển đổi D1: batch nguyên tử – một câu lỗi thì hoàn tác tất cả', async () => {
  const { db } = createTestDb();
  await assert.rejects(db.batch([
    db.insert(positions).values({ id: 'zz-a', name: 'A' }),
    db.insert(positions).values({ id: 'zz-b', name: 'B' }),
    db.insert(positions).values({ id: 'zz-a', name: 'Trùng' }), // vi phạm khoá chính
  ]));
  assert.deepEqual(await mine(db), []);
  await db.batch([db.insert(positions).values({ id: 'zz-a', name: 'A' }), db.insert(positions).values({ id: 'zz-b', name: 'B' })]);
  assert.equal((await mine(db)).length, 2);
});

test('bộ chuyển đổi D1: upsert có RETURNING đọc được kết quả', async () => {
  const { db } = createTestDb();
  const up = () => db.insert(positions).values({ id: 'zz-a', name: 'A' }).onConflictDoUpdate({ target: positions.id, set: { name: 'A2' } }).returning({ name: positions.name });
  assert.deepEqual(await up(), [{ name: 'A' }]);
  assert.deepEqual(await up(), [{ name: 'A2' }]);
});
