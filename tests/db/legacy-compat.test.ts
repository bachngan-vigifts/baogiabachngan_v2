import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as legacy from './fixtures/legacy-schema.ts';
import { legacyRuntimeDdl } from './fixtures/legacy-runtime-ddl.ts';
import { openMigratedDb, columnsOf, tablesIn } from './helpers.ts';

/** Cột cố ý bỏ ở bản mới (đã có bảng thay thế). */
const REMOVED = new Set(['sapo_customers.discounts']); // -> customer_brand_discounts

const legacyTables = tablesIn(legacy).map(getTableConfig);

test('bản cũ có đúng 37 bảng khai báo', () => assert.equal(legacyTables.length, 37));

test('mọi bảng cũ vẫn còn, mọi cột cũ giữ nguyên tên, kiểu và NOT NULL (trừ cột bỏ có chủ đích)', () => {
  const db = openMigratedDb();
  for (const t of legacyTables) {
    const now = new Map(columnsOf(db, t.name).map(c => [c.name, c]));
    assert.ok(now.size > 0, `thiếu bảng ${t.name}`);
    for (const col of t.columns) {
      const key = `${t.name}.${col.name}`;
      if (REMOVED.has(key)) { assert.ok(!now.has(col.name), `${key} lẽ ra phải bị bỏ`); continue; }
      const cur = now.get(col.name);
      assert.ok(cur, `mất cột ${key}`);
      assert.equal(cur.type.toLowerCase(), col.getSQLType().toLowerCase(), `đổi kiểu ${key}`);
      assert.equal(!!cur.notnull, col.notNull, `đổi NOT NULL ${key}`);
    }
    const oldPk = t.columns.filter(c => c.primary).map(c => c.name).sort();
    const newPk = [...now.values()].filter(c => c.pk > 0).map(c => c.name).sort();
    if (oldPk.length) assert.deepEqual(newPk, oldPk, `đổi khoá chính ${t.name}`);
  }
});

test('5 bảng bản cũ tự tạo lúc runtime: schema mới là tập cha (cùng cột, kiểu, NOT NULL)', () => {
  const db = openMigratedDb();
  const old = new DatabaseSync(':memory:');
  for (const [name, ddl] of Object.entries(legacyRuntimeDdl)) {
    old.exec(ddl);
    const now = new Map(columnsOf(db, name).map(c => [c.name, c]));
    for (const c of columnsOf(old, name)) {
      const cur = now.get(c.name);
      assert.ok(cur, `mất cột ${name}.${c.name}`);
      assert.equal(cur.type.toLowerCase(), c.type.toLowerCase(), `đổi kiểu ${name}.${c.name}`);
      // SQLite cho phép NULL ở khoá chính TEXT khai báo kiểu `id TEXT PRIMARY KEY`; bản mới chặt hơn (NOT NULL) là chấp nhận được.
      if (c.pk === 0) assert.equal(cur.notnull, c.notnull, `đổi NOT NULL ${name}.${c.name}`);
      else assert.equal(cur.notnull, 1, `khoá chính ${name}.${c.name} phải NOT NULL`);
    }
  }
});

test('dữ liệu bản cũ chèn được nguyên văn vào bảng mới (đại diện: nhân viên, báo giá, khách, công nợ)', () => {
  const db = openMigratedDb();
  db.exec(`INSERT INTO staff_members (id,email,name,created_at) VALUES ('m1','a@b.vn','An','2026-01-01')`);
  db.exec(`INSERT INTO staff_quotations (id,creator_id,quote_no,quote_type,customer,data,created_at,updated_at) VALUES ('q1','m1','BG1','HRC','K','{"rows":[]}','2026-01-01','2026-01-01')`);
  db.exec(`INSERT INTO sapo_customers (id,name,contact,phone,email,address,search,source_version,synced_at) VALUES ('c1','A','','','','','a',1,'2026-01-01')`);
  // dòng công nợ đúng định dạng 3 cột của bản cũ
  db.exec(`INSERT INTO quote_order_followups (quote_id,data,updated_at) VALUES ('q1','{"total":100}','2026-01-01')`);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM quote_order_followups').get() as { n: number }).n, 1);
});
