import { stockMoves } from '../../inventory/schema.ts';
import { posReturns } from '../return-schema.ts';
import { posOrderReservations } from '../pos-order-flow-schema.ts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import {
  customerPayments,
  salesOrders,
  packingSlips,
  deliveries,
} from '../schema.ts';
import { saleFlowOf } from '../domain/pos-order-flow.ts';
import type { CashDb } from './cash-store.ts';
export async function assertPosFlowFulfillable(
  db: CashDb,
  orderId: string,
  pickup = false,
) {
  const [o] = await db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (!o) throw new AppError(404, 'Không tìm thấy đơn.');
  const flow = saleFlowOf(o.posSnapshot);
  await assertNoStockRecovery(db,orderId);
  if (!flow) return;
  if (o.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ.');
  if (flow === 'deposit' && !pickup)
    throw new AppError(409, 'Đơn cọc phải dùng Thu nốt và xuất hàng tại quầy.');
  const holds = await db
    .select()
    .from(posOrderReservations)
    .where(eq(posOrderReservations.orderId, orderId));
  if (
    !holds.length ||
    holds.some(
      (r) => r.status !== 'active' || r.expiresAt <= new Date().toISOString(),
    )
  )
    throw new AppError(
      409,
      'Hết hạn giữ hàng: giữ lại đủ hàng trước khi xuất.',
      'POS_FLOW_HOLD_EXPIRED',
    );
  const [p] = await db
    .select({
      n: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(
        Number,
      ),
    })
    .from(customerPayments)
    .where(
      and(
        eq(customerPayments.orderId, orderId),
        isNull(customerPayments.voidedAt),
      ),
    );
  if ((p?.n || 0) < o.total)
    throw new AppError(
      409,
      'Chưa thực nhận đủ tiền, không được đóng gói hoặc xuất hàng.',
      'POS_FLOW_UNPAID',
    );
}

/** Physical issues, independent of delivery labels; used for pre-delivery recovery and to prevent cancelling issued goods. */
export async function flowIssued(db: CashDb, orderId: string) {
  return db
    .select({
      sku: stockMoves.sku,
      qty: sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number),
    })
    .from(stockMoves)
    .where(
      sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${orderId}) or (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} where ${packingSlips.id}=${stockMoves.refId} and ${packingSlips.orderId}=${orderId})) or (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} where ${deliveries.id}=${stockMoves.refId} and ${deliveries.orderId}=${orderId}))`,
    )
    .groupBy(stockMoves.sku);
}

/** Active recall freezes further dispatch for ordinary COD as well as deposit/prepaid orders. */
export async function assertNoStockRecovery(db:CashDb,orderId:string) {
  const [recovery] = await db
    .select({ id: posReturns.id })
    .from(posReturns)
    .where(
      and(
        eq(posReturns.orderId, orderId),
        eq(posReturns.requestContext, 'after_issue'),
        sql`${posReturns.status} not in ('cancelled','rejected')`,
      ),
    )
    .limit(1);
  if (recovery)
    throw new AppError(
      409,
      'Đơn đang thu hồi hàng đã xuất; xử lý phiếu trả trước.',
    );
}
