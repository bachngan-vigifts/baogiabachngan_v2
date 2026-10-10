import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { orderProgressMarks, packingSlips, salesOrders } from '../schema.ts';

type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const AUTO_PACKED_NOTE = 'Tự động hoàn tất: đơn đã giao.';

/**
 * Đơn đã giao xong (trạng thái "Đã giao xong", hoặc Manager đánh dấu tiến trình "Giao hàng") → phiếu đóng gói còn treo tự hoàn tất:
 * phiếu đã gửi kho → "Kho đã đóng" (ghi chú tự động; việc "Đóng gói" của kho tự đóng theo), phiếu nháp chưa gửi → huỷ.
 * `orderIds` bỏ trống = quét mọi đơn (dọn phiếu cũ còn kẹt). Trả số phiếu đã đổi.
 */
export async function closeSlipsOfDeliveredOrders(db: Db | Tx, orderIds?: readonly string[]) {
  if (orderIds && !orderIds.length) return 0;
  const done = or(
    sql`EXISTS (SELECT 1 FROM ${salesOrders} WHERE ${salesOrders.id} = ${packingSlips.orderId} AND ${salesOrders.status} = 'delivered')`,
    sql`EXISTS (SELECT 1 FROM ${orderProgressMarks} WHERE ${orderProgressMarks.orderId} = ${packingSlips.orderId} AND ${orderProgressMarks.stage} = 'delivered')`,
  );
  const scope = orderIds ? inArray(packingSlips.orderId, [...orderIds]) : undefined, now = new Date().toISOString();
  const packed = await db.update(packingSlips).set({ status: 'packed', packedAt: now, packedNote: AUTO_PACKED_NOTE, updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
    .where(and(eq(packingSlips.status, 'sent'), scope, done)).returning({ id: packingSlips.id });
  const cancelled = await db.update(packingSlips).set({ status: 'cancelled', updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
    .where(and(eq(packingSlips.status, 'draft'), scope, done)).returning({ id: packingSlips.id });
  return packed.length + cancelled.length;
}
