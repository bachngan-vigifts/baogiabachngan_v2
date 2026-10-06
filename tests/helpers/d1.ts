/* eslint-disable @typescript-eslint/no-explicit-any */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Giả lập Cloudflare D1 trên node:sqlite, đủ trung thực để chạy ĐÚNG đường code production (`drizzle-orm/d1`):
 *  - `.all()` trả `{results: [{cột: giá trị}]}`; `.raw()` trả mảng các mảng; `.run()` trả `meta.changes`;
 *  - `.batch([...])` chạy nguyên tử (một giao dịch, lỗi thì hoàn tác tất cả);
 *  - từ chối tham số `undefined` như D1 thật; khoá ngoại luôn bật.
 */
const writes = (s: StatementSync) => s.columns().length === 0;

export class TestStmt {
  constructor(private sqlite: DatabaseSync, readonly sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) {
    if (params.some(p => p === undefined)) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
    return new TestStmt(this.sqlite, this.sql, params);
  }
  private st() { return this.sqlite.prepare(this.sql); }
  async all() {
    const st = this.st();
    if (writes(st)) { const r = st.run(...this.params as never[]); return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    return { results: st.all(...this.params as never[]).map(r => ({ ...r })), success: true, meta: {} };
  }
  async run() {
    const st = this.st();
    if (!writes(st)) { const rows = st.all(...this.params as never[]); return { results: rows.map(r => ({ ...r })), success: true, meta: { changes: 0 } }; }
    const r = st.run(...this.params as never[]);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() { const st = this.st(); st.setReturnArrays(true); return st.all(...this.params as never[]) as unknown as unknown[][]; }
  async first(col?: string) { const rows = (await this.all()).results as any[]; const r = rows[0]; return r ? (col ? r[col] : r) : null; }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() { this.sqlite.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql: string) { return new TestStmt(this.sqlite, sql); }
  async batch(stmts: TestStmt[]) {
    this.sqlite.exec('BEGIN');
    try { const out = []; for (const s of stmts) out.push(await s.all()); this.sqlite.exec('COMMIT'); return out; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
  exec(sql: string) { this.sqlite.exec(sql); }
  /** Áp mọi file SQL trong một thư mục migration (tách theo `--> statement-breakpoint`). */
  migrate(dir: string) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort())
      for (const st of readFileSync(join(dir, f), 'utf8').split('--> statement-breakpoint')) if (st.trim()) this.sqlite.exec(st);
    return this;
  }
}
