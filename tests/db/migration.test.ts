import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../src/db/schema.ts';
import { openMigratedDb, tablesOf, tablesIn, columnsOf } from './helpers.ts';
const declared = tablesIn(schema).map(t => getTableConfig(t).name).sort();

test('PostgreSQL migration tạo đúng các bảng đã khai báo', async () => {
  const db = await openMigratedDb();
  assert.deepEqual(await tablesOf(db), declared);
  assert.equal(declared.length, 115);
});

test('mọi bảng PostgreSQL có khoá chính', async () => {
  const db = await openMigratedDb();
  for (const t of await tablesOf(db)) assert.ok((await columnsOf(db, t)).some(c => c.pk), `${t} thiếu khoá chính`);
});

test('mọi khoá ngoại PostgreSQL trỏ tới bảng tồn tại', async () => {
  const db = await openMigratedDb();
  const names = new Set(await tablesOf(db));
  const r = await db.client.query<{ source: string; target: string }>(`
    SELECT a.relname AS source, b.relname AS target FROM pg_constraint c
    JOIN pg_class a ON a.oid=c.conrelid JOIN pg_class b ON b.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=a.relnamespace WHERE c.contype='f' AND n.nspname='public'`);
  assert.ok(r.rows.length > 0);
  for (const fk of r.rows) assert.ok(names.has(fk.target), `${fk.source} -> ${fk.target}`);
});
