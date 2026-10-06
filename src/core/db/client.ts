import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// Schema được truyền từ nơi lắp ráp ứng dụng; core không phụ thuộc module nghiệp vụ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PostgresJsDatabase<any>;

/** Tạo một kết nối cho mỗi request trên Workers, dùng Supabase transaction pooler. */
export function createDb<S extends Record<string, unknown>>(databaseUrl: string, schema: S) {
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL cho Supabase.');
  const client = postgres(databaseUrl, {
    prepare: false, max: 1, ssl: 'require', idle_timeout: 20, connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** Gọi trong finally (hoặc ctx.waitUntil) sau khi xử lý request để đóng kết nối. */
export const closeDb = (db: AnyDb & { $client: postgres.Sql }) => db.$client.end({ timeout: 5 });
