import type { StaffEnv } from '../../staff/api/auth-routes.ts';

export type InvoiceTaskRef = { orderId: string } | { webOrderId: string };
/** Wired by the app: sales commits first; a task/notification failure must not roll back a sale. */
export const invoiceTaskHooks: { afterCommit?: (env: StaffEnv, ref: InvoiceTaskRef, actorId: string | null) => Promise<void> } = {};
export async function invoiceTasksChanged(env: StaffEnv, ref: InvoiceTaskRef, actorId: string | null = null) {
  const job = (async () => { try { await invoiceTaskHooks.afterCommit?.(env, ref, actorId); }
    catch (e) { console.error('invoice task sync failed', ref, e instanceof Error ? e.message : e); } })();
  // Việc "Xuất hoá đơn" đồng bộ nền sau khi trả lời (giao hàng / bán quầy không phải chờ); test không có waitUntil thì chờ.
  if (env.waitUntil) env.waitUntil(job); else await job;
}

/** Wired by the app: việc Sổ quỹ (duyệt phiếu, đổi/trả, tra soát, kết ca) đồng bộ ngay sau khi chứng từ đã lưu; lỗi không làm hỏng thao tác. */
export const cashTaskHooks: { afterCommit?: (env: StaffEnv) => Promise<void> | void } = {};
export async function cashTasksChanged(env: StaffEnv) {
  try { await cashTaskHooks.afterCommit?.(env); }
  catch (e) { console.error('cash task sync failed', e instanceof Error ? e.message : e); }
}
