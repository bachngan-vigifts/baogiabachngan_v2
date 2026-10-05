import { sql } from 'drizzle-orm';
import { check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * `text(..., { enum })` của Drizzle chỉ kiểm tra ở TypeScript – DB vẫn nhận giá trị bất kỳ.
 * Dùng helper này trong `t => [...]` để DB cũng từ chối giá trị lạ (quan trọng với cột liên quan phân quyền/trạng thái).
 * Cột cho phép NULL vẫn nhận NULL.
 */
export const enumCheck = (name: string, column: AnySQLiteColumn, values: readonly string[]) =>
  check(name, sql`${column} IN (${sql.raw(values.map(v => `'${v.replace(/'/g, "''")}'`).join(', '))})`);
