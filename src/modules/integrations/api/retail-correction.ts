import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { sapoHealthMonitorState } from '../schema.ts';
import { customers } from '../../customers/schema.ts';
const queryRows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown })?.rows;
  if (Array.isArray(rows)) return rows;
  throw new Error('Unsupported database result');
};
/** Roll back only unused rows created by this import; retain a recovery snapshot. Never cascade customer data. */
export async function rollbackImportedRetail(db: AnyDb, ids: string[], progress?: Record<string, any>) {
  return db.transaction(async tx => {
    const rows = await tx.select().from(customers).where(and(eq(customers.isRetail, true), inArray(customers.id, ids))).for('update');
    if (rows.length !== ids.length || rows.some(r => r.createdBy !== null)) throw new AppError(409, 'Hồ sơ đã thay đổi, cần đối chiếu riêng.');
    // Check every customer_id relation, including tables without a declared FK. Identifiers come only from the DB catalog.
    const relations = queryRows(await tx.execute(sql`select table_schema,table_name,column_name from information_schema.columns where table_schema='public' and column_name='customer_id'`));
    for (const r of relations) {
      const linked = queryRows(await tx.execute(sql`select 1 from ${sql.identifier(String(r.table_schema))}.${sql.identifier(String(r.table_name))} where ${sql.identifier(String(r.column_name))}::text in (${sql.join(ids.map(id => sql`${id}`), sql`,`)}) limit 1`));
      if (linked.length) throw new AppError(409, 'Khách mới đã được sử dụng; không tự thu hồi.', 'RETAIL_IN_USE');
    }
    for (const id of ids) {
      const quotes = queryRows(await tx.execute(sql`select 1 from public.staff_quotations where data like ${'%"' + id + '"%'} limit 1`));
      if (quotes.length) throw new AppError(409, 'Khách mới đã có liên kết báo giá; không tự thu hồi.', 'RETAIL_IN_USE');
    }
    await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: null, module: 'integrations', action: 'retail-import-correction', entityType: 'retail-import', entityId: 'retail-customer-import', data: JSON.stringify({ reason: 'Sapo tax_number identifies these newly imported rows as outside the retail criteria', rows }), createdAt: new Date().toISOString() });
    const removed = await tx.delete(customers).where(and(eq(customers.isRetail, true), inArray(customers.id, ids))).returning({ id: customers.id });
    if (progress) {
      progress.totals.added -= removed.length; progress.totals.eligible -= removed.length; progress.totals.excluded += removed.length;
      progress.correctedInitialRows = removed.length; progress.initialBatchChecked = true;
      const updatedAt = new Date().toISOString();
      await tx.insert(sapoHealthMonitorState).values({ id: 'retail-customer-import', data: JSON.stringify(progress), updatedAt }).onConflictDoUpdate({ target: sapoHealthMonitorState.id, set: { data: JSON.stringify(progress), updatedAt } });
    }
    return removed.length;
  });
}
