/* PostgreSQL thật (WASM), chạy migration và Drizzle PostgreSQL trong test, không cần mật khẩu server. */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'node:test';
import type { AnyDb } from '../../src/core/db/client.ts';
import * as schema from '../../src/db/schema.ts';

export const migrationsDir = join(import.meta.dirname, '../../migrations/postgres');
const open: PGlite[] = [];
afterEach(async () => { for (const client of open.splice(0)) await client.close(); });

const boolColumns = new Map(Object.values(schema).map(t => {
  const config = getTableConfig(t);
  return [config.name, new Set(config.columns.filter(c => c.dataType === 'boolean').map(c => c.name))] as const;
}));

/** Chỉ dành cho dữ liệu mồi SQLite cũ: đổi ? thành $n và cờ 0/1 thành boolean. */
export class PgFixture {
  constructor(readonly client: PGlite) {}
  private convert(query: string, params: unknown[]) {
    let n = 0;
    let sql = query.replace(/'((?:''|[^'])*)'|\?/g, (m: string) => m === '?' ? `$${++n}` : m);
    const table = /(?:INSERT(?: OR IGNORE)? INTO|UPDATE)\s+([a-z_]+)/i.exec(sql)?.[1];
    const bools = boolColumns.get(table ?? '') ?? new Set<string>();
    for (const col of bools) sql = sql.replace(new RegExp(`\\b${col}\\s*=\\s*([01])\\b`, 'g'), (_, v) => `${col}=${v === '1' ? 'true' : 'false'}`);
    const insert = /INSERT(?: OR IGNORE)? INTO\s+[a-z_]+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
    const values = [...params];
    if (insert) {
      const cols = insert[1]!.split(',').map(c => c.trim());
      const vals = insert[2]!.split(',').map(c => c.trim());
      for (let i = 0; i < cols.length; i++) {
        if (!bools.has(cols[i]!)) continue;
        const p = /^\$(\d+)$/.exec(vals[i]!);
        if (p) values[Number(p[1]) - 1] = Boolean(values[Number(p[1]) - 1]);
        else if (/^[01]$/.test(vals[i]!)) vals[i] = vals[i] === '1' ? 'true' : 'false';
      }
      sql = sql.replace(insert[2]!, vals.join(','));
    }
    if (/INSERT OR IGNORE/i.test(sql)) sql = sql.replace(/INSERT OR IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
    return { sql, values };
  }
  prepare(query: string) {
    const execute = async (...params: unknown[]) => {
      const { sql, values } = this.convert(query, params);
      const r = await this.client.query<Record<string, unknown>>(sql, values);
      return r.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'boolean' ? Number(v) : typeof v === 'bigint' ? Number(v) : v])));
    };
    return { run: execute, all: execute, get: async (...params: unknown[]) => (await execute(...params))[0] };
  }
  async exec(sql: string) { const q = this.convert(sql, []); await this.client.exec(q.sql); }
}

export async function createTestDb() {
  const client = new PGlite(); open.push(client);
  await client.waitReady;
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    // RLS/GRANT trên Supabase có kiểm tra riêng với role thật; PGlite không có các role platform.
    if (file.includes('supabase_access')) continue;
    for (const stmt of readFileSync(join(migrationsDir, file), 'utf8').split('--> statement-breakpoint'))
      if (stmt.trim()) await client.exec(stmt);
  }
  const fixture = new PgFixture(client);
  return { client, d1: { sqlite: fixture }, db: drizzle(client, { schema }) as unknown as AnyDb };
}
