import { eq, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { posPaymentRequests } from '../pos-schema.ts';
import { salesOrders } from '../schema.ts';
import { nextDocNo } from '../domain/sales.ts';
import { reservedPosOrderNo } from '../domain/pos-qr-reference.ts';
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
/** Caller holds cashLock. The day lock is shared with all POS number allocation. Never recycle an abandoned QR reference. */
export async function nextPosOrderNo(db: Db, date: string): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-number:' + date}))`);
  const prefix = 'POS_' + date.replaceAll('-', '') + '_';
  const [orders, reservations] = await Promise.all([
    db.select({ no: salesOrders.orderNo }).from(salesOrders).where(sql`${salesOrders.orderNo} like ${prefix + '%'}`),
    db.select({ cart: posPaymentRequests.cart }).from(posPaymentRequests).where(sql`${posPaymentRequests.cart} like ${'%' + prefix + '%'}`),
  ]);
  return nextDocNo('POS', date, [...orders.map(x => x.no), ...reservations.map(x => reservedPosOrderNo(x.cart)).filter((no): no is string => !!no)]);
}
export async function orderNoForCheckout(db: Db, date: string, qr?: { cart: string }): Promise<string> {
  const reserved = qr && reservedPosOrderNo(qr.cart);
  if (!reserved) return nextPosOrderNo(db, date);
  const [existing] = await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.orderNo, reserved)).limit(1);
  if (existing) throw new AppError(409, 'Yêu cầu QR đã được dùng cho một đơn hàng.');
  return reserved;
}
