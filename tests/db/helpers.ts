import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { is } from 'drizzle-orm';
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core';

/** Lấy mọi bảng drizzle từ một module export (schema). */
export const tablesIn = (mod: Record<string, unknown>): AnySQLiteTable[] =>
  Object.values(mod).filter(v => is(v, SQLiteTable)) as AnySQLiteTable[];

const root = join(import.meta.dirname, '..', '..');

/** Mở DB SQLite trong bộ nhớ với khoá ngoại bật (giống D1) và áp toàn bộ migration theo thứ tự. */
export function openMigratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(root, 'migrations');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
  return db;
}

export type ColumnInfo = { name: string; type: string; notnull: number; pk: number };
export const columnsOf = (db: DatabaseSync, table: string) =>
  db.prepare(`PRAGMA table_info(\`${table}\`)`).all() as unknown as ColumnInfo[];
export const tablesOf = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as { name: string }[]).map(r => r.name);

export const NOW = '2026-10-05T00:00:00.000Z';

/** Tạo nhanh nhân viên + báo giá tối thiểu để các test ràng buộc dùng lại. */
export function seedStaffAndQuote(db: DatabaseSync, quoteId = 'q1') {
  db.prepare("INSERT OR IGNORE INTO staff_members (id,email,name,created_at) VALUES ('m1','a@b.vn','An',?)").run(NOW);
  db.prepare("INSERT INTO staff_quotations (id,creator_id,quote_no,quote_type,customer,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(quoteId, 'm1', `BG-${quoteId}`, 'B2B', 'Khách A', '{}', NOW, NOW);
}
