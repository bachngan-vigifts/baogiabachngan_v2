import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

/** Kiểu cơ sở dữ liệu mà các repo nhận vào: Drizzle trên D1 (có `batch`). Repo không cần biết schema tổng. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = DrizzleD1Database<any>;

/** Phần của Cloudflare D1 mà ứng dụng dùng (khai báo tối thiểu để không phụ thuộc @cloudflare/workers-types). */
export interface D1Like {
  prepare(sql: string): unknown;
  batch(statements: unknown[]): Promise<unknown[]>;
}

/**
 * Tạo kết nối Drizzle trên D1. `schema` do nơi lắp ráp ứng dụng truyền vào (src/app) – lõi không import module nào.
 * Ghi nhiều câu lệnh nguyên tử: dùng `db.batch([...])` (D1 không hỗ trợ `db.transaction`).
 */
export function createDb<S extends Record<string, unknown>>(d1: D1Like, schema: S) {
  return drizzle(d1 as never, { schema });
}
