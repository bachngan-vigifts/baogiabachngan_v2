import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, like } from 'drizzle-orm';
import type { AnyDb } from '../../src/core/db/client.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { positions } from '../../src/modules/staff/schema.ts';

const mine = (db: AnyDb) => db.select().from(positions).where(like(positions.id, 'zz-%'));

test('PostgreSQL: chèn/đọc/cập nhật qua Drizzle, RETURNING phân biệt dòng tồn tại', async () => {
  const { db } = await createTestDb();
  await db.insert(positions).values({ id: 'zz-sale', name: 'ZZ Sale' });
  assert.deepEqual(await mine(db), [{ id: 'zz-sale', name: 'ZZ Sale' }]);
  assert.equal((await db.update(positions).set({ name: 'Bán hàng' }).where(eq(positions.id, 'zz-sale')).returning()).length, 1);
  assert.equal((await db.update(positions).set({ name: 'x' }).where(eq(positions.id, 'khong-co')).returning()).length, 0);
});

test('PostgreSQL: transaction nguyên tử – một câu lỗi hoàn tác toàn bộ', async () => {
  const { db } = await createTestDb();
  await assert.rejects(db.transaction(async tx => {
    await tx.insert(positions).values({ id: 'zz-a', name: 'A' });
    await tx.insert(positions).values({ id: 'zz-b', name: 'B' });
    await tx.insert(positions).values({ id: 'zz-a', name: 'Trùng' });
  }));
  assert.deepEqual(await mine(db), []);
  await db.transaction(async tx => {
    await tx.insert(positions).values({ id: 'zz-a', name: 'A' });
    await tx.insert(positions).values({ id: 'zz-b', name: 'B' });
  });
  assert.equal((await mine(db)).length, 2);
});

test('PostgreSQL: upsert có RETURNING đọc được kết quả', async () => {
  const { db } = await createTestDb();
  const up = () => db.insert(positions).values({ id: 'zz-a', name: 'A' }).onConflictDoUpdate({ target: positions.id, set: { name: 'A2' } }).returning({ name: positions.name });
  assert.deepEqual(await up(), [{ name: 'A' }]);
  assert.deepEqual(await up(), [{ name: 'A2' }]);
});
