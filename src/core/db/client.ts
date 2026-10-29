import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// Schema được truyền từ nơi lắp ráp ứng dụng; core không phụ thuộc module nghiệp vụ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PostgresJsDatabase<any>;

/**
 * Kết nối qua Supabase transaction pooler. Mặc định 1 kết nối (mỗi request một client);
 * Edge Function dùng lifecycle theo request khi kết nối trực tiếp; chỉ giữ client ấm khi có transaction pooler.
 */
export function createDb<S extends Record<string, unknown>>(databaseUrl: string, schema: S, opts: { max?: number; idleTimeout?: number; onQuery?: () => void } = {}) {
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL cho Supabase.');
  const client = postgres(databaseUrl, {
    prepare: false, max: opts.max ?? 1, ssl: 'require', idle_timeout: opts.idleTimeout ?? 20, connect_timeout: 10,
  });
  // onQuery: đếm số truy vấn của mỗi yêu cầu (header Server-Timing) – không ghi nội dung SQL / tham số.
  const onQuery = opts.onQuery;
  return drizzle(client, { schema, ...(onQuery ? { logger: { logQuery: () => onQuery() } } : {}) });
}

/** Gọi trong finally (hoặc ctx.waitUntil) sau khi xử lý request để đóng kết nối. */
export const closeDb = (db: AnyDb & { $client: postgres.Sql }) => db.$client.end({ timeout: 5 });
