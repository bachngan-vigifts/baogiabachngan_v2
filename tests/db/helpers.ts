import { DatabaseSync } from 'node:sqlite';
import { is } from 'drizzle-orm';
import { PgTable, type AnyPgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core';
import { createTestDb, PgFixture } from '../helpers/postgres.ts';

export const tablesIn = (mod: Record<string, unknown>): AnyPgTable[] =>
  Object.values(mod).filter(v => is(v, PgTable)) as AnyPgTable[];
export const legacyTablesIn = (mod: Record<string, unknown>): AnySQLiteTable[] =>
  Object.values(mod).filter(v => is(v, SQLiteTable)) as AnySQLiteTable[];

export async function openMigratedDb() { return (await createTestDb()).d1.sqlite; }
export type ColumnInfo = { name: string; type: string; notnull: number; pk: number };
export async function columnsOf(db: PgFixture | DatabaseSync, table: string): Promise<ColumnInfo[]> {
  if (db instanceof DatabaseSync) return db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as ColumnInfo[];
  const r = await db.client.query<{ name: string; type: string; notnull: number; pk: number }>(`
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull::int AS notnull,
      CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) THEN 1 ELSE 0 END AS pk
    FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=$1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
  return r.rows;
}
export async function tablesOf(db: PgFixture) {
  const r = await db.client.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  return r.rows.map(r => r.name);
}
export const NOW = '2026-10-05T00:00:00.000Z';
export async function seedStaffAndQuote(db: PgFixture, quoteId = 'q1') {
  await db.prepare("INSERT OR IGNORE INTO staff_members (id,email,name,created_at) VALUES ('m1','a@b.vn','An',?)").run(NOW);
  await db.prepare('INSERT INTO staff_quotations (id,creator_id,quote_no,quote_type,customer,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(quoteId, 'm1', `BG-${quoteId}`, 'B2B', 'Khách A', '{}', NOW, NOW);
}
