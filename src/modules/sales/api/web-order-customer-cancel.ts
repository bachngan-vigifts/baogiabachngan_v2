/**
 * KHÁCH HUỶ ĐƠN TRÊN WEBSITE (webhook WooCommerce báo trạng thái "cancelled"):
 *  - Chưa có vận đơn GHN → đơn CRM huỷ theo website.
 *  - GHN chưa lấy hàng (chờ lấy / đang đi lấy) → CRM huỷ vận đơn trên GHN rồi huỷ đơn CRM.
 *    GHN từ chối / chưa kết nối được → giữ nguyên đơn, báo Manager xử lý trên GHN (lượt webhook sau thử lại).
 *  - GHN đã lấy hàng → không đổi đơn: xử lý theo quy trình GHN (giao / hoàn hàng). Ghi nhật ký và báo Manager một lần.
 */
import { and, eq, sql } from 'drizzle-orm';
import { writeAudit } from '../../../core/audit.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { webStoreOrders } from '../pos-schema.ts';
import { webOrderBucket } from '../domain/web-order-outcome.ts';
import { cancelWebOrderGhn } from './web-order-ghn.ts';

/** Trạng thái GHN mà hàng chưa rời shop: còn huỷ được vận đơn. */
export const GHN_BEFORE_PICKUP = new Set(['', 'ready_to_pick', 'picking', 'money_collect_picking']);
export const websiteCancelled = (status: unknown) => typeof status === 'string' && status.trim().toLowerCase().replace(/^wc-/, '') === 'cancelled';

export type CustomerCancelOutcome = 'none' | 'cancelled' | 'ghn_cancelled' | 'ghn_cancel_failed' | 'after_pickup';

export async function applyWebsiteCancel(env: StaffEnv, orderId: string): Promise<CustomerCancelOutcome> {
  const step = await env.db.transaction(async tx => {
    const [o] = await tx.select().from(webStoreOrders).where(eq(webStoreOrders.id, orderId)).limit(1).for('update');
    if (!o || ['cancelled', 'completed'].includes(webOrderBucket(o.status, o.ghnStatus))) return { outcome: 'none' as const };
    const ghn = o.ghnStatus.trim().toLowerCase(), now = new Date().toISOString();
    if (!o.ghnOrderCode) {
      await tx.update(webStoreOrders).set({ status: 'cancelled', updatedAt: now }).where(eq(webStoreOrders.id, o.id));
      return { outcome: 'cancelled' as const, order: o };
    }
    if (!GHN_BEFORE_PICKUP.has(ghn)) return { outcome: 'after_pickup' as const, order: o };
    try {
      // Khoá dòng trong lúc gọi GHN: webhook gửi lặp không huỷ hai lần.
      await cancelWebOrderGhn(env, o.ghnOrderCode, o.source === 'lock' ? 'lock' : 'minhlong');
    } catch (e) {
      return { outcome: 'ghn_cancel_failed' as const, order: o, error: e instanceof Error ? e.message : String(e) };
    }
    await tx.update(webStoreOrders).set({ status: 'cancelled', ghnStatus: 'cancel', updatedAt: now }).where(eq(webStoreOrders.id, o.id));
    return { outcome: 'ghn_cancelled' as const, order: o };
  });
  if (step.outcome === 'none' || !step.order) return 'none';
  const o = step.order, action = `web-order-customer-cancel-${step.outcome.replaceAll('_', '-')}`;
  const data = { source: o.source, externalId: o.externalId, orderNo: o.orderNo, ghnOrderCode: o.ghnOrderCode, ghnStatus: o.ghnStatus, ...('error' in step ? { error: step.error } : {}) };
  // Chưa đổi được đơn: chỉ báo một lần cho mỗi đơn / tình huống (webhook có thể gửi lại nhiều lần).
  const warn = step.outcome === 'ghn_cancel_failed' || step.outcome === 'after_pickup';
  if (warn) {
    const [seen] = await env.db.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'web-store-order'), eq(auditLogs.entityId, o.id), eq(auditLogs.action, action), sql`${auditLogs.createdAt} > ${new Date(Date.now() - 86_400_000).toISOString()}`)).limit(1);
    if (seen) return step.outcome;
  }
  await writeAudit(env.db, { actorId: null, module: 'sales', action, entityType: 'web-store-order', entityId: o.id, data });
  if (warn) await notifyMany(env, 'managers', {
    eventType: 'web_order_customer_cancel',
    title: step.outcome === 'after_pickup' ? `Khách huỷ đơn web ${o.orderNo} sau khi GHN đã lấy hàng` : `Khách huỷ đơn web ${o.orderNo} – chưa huỷ được vận đơn GHN`,
    body: step.outcome === 'after_pickup'
      ? `Vận đơn ${o.ghnOrderCode} đang ở trạng thái GHN "${o.ghnStatus}". Xử lý theo quy trình GHN (chặn giao / hoàn hàng); CRM cập nhật theo GHN.`
      : `Vận đơn ${o.ghnOrderCode}: ${'error' in step ? step.error : ''} Huỷ vận đơn trên GHN; CRM sẽ cập nhật khi GHN báo huỷ.`,
    url: '/index.html#/pos', data: { webOrderId: o.id, outcome: step.outcome },
  });
  return step.outcome;
}
