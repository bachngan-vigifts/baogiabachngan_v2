import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../../src/db/schema.ts';
import { openMigratedDb, tablesOf, tablesIn } from './helpers.ts';

const declared = tablesIn(schema).map(t => getTableConfig(t).name).sort();

test('migration chạy sạch trên DB trống và tạo đúng các bảng đã khai báo', () => {
  const db = openMigratedDb();
  assert.deepEqual(tablesOf(db), declared);
  assert.equal(declared.length, 62);
});

test('mọi bảng đều có khoá chính', () => {
  const db = openMigratedDb();
  for (const t of tablesOf(db)) {
    const pk = (db.prepare(`PRAGMA table_info(\`${t}\`)`).all() as { pk: number }[]).filter(c => c.pk > 0);
    assert.ok(pk.length > 0, `${t} thiếu khoá chính`);
  }
});

test('khoá ngoại không trỏ tới bảng không tồn tại', () => {
  const db = openMigratedDb();
  const names = new Set(tablesOf(db));
  for (const t of names) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list(\`${t}\`)`).all() as { table: string }[]) {
      assert.ok(names.has(fk.table), `${t} -> ${fk.table} không tồn tại`);
    }
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
