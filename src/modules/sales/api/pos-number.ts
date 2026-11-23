import { documentNumberPatterns, nextDocumentNumber } from '../../../core/document-number.ts';
import { eq, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { posPaymentRequests } from '../pos-schema.ts';
import { salesOrders } from '../schema.ts';
import { reservedPosOrderNo } from '../domain/pos-qr-reference.ts';
import { posOrderPrefix, posStoreCode } from '../domain/pos-store-code.ts';
import { warehouses } from '../../catalog/schema.ts';
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
/** Tiền tố số đơn POS theo cửa hàng của quầy (POS_ML / POS_LOCK; không rõ cửa hàng → POS). */
export async function posOrderPrefixFor(db: Db, register: { name: string; warehouseId: string }): Promise<string> {
  const [w] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, register.warehouseId)).limit(1);
  return posOrderPrefix(posStoreCode(register.name, w?.name));
}
/** Caller holds cashLock. The day lock is shared with all POS number allocation. Never recycle an abandoned QR reference. */
export async function nextPosOrderNo(db: Db, date: string, prefix = 'POS'): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-number:' + date}))`);
  const patterns = documentNumberPatterns(prefix, date);
  const [orders, reservations] = await Promise.all([
    db.select({ no: salesOrders.orderNo }).from(salesOrders).where(or(...patterns.map(pattern => sql`${salesOrders.orderNo} LIKE ${pattern}`))),
    db.select({ cart: posPaymentRequests.cart }).from(posPaymentRequests).where(or(...patterns.map(pattern => sql`${posPaymentRequests.cart} LIKE ${'%' + pattern + '%'}`))),
  ]);
  return nextDocumentNumber(prefix, date, [...orders.map(x => x.no), ...reservations.map(x => reservedPosOrderNo(x.cart)).filter((no): no is string => !!no)]);
}
export async function orderNoForCheckout(db: Db, date: string, qr?: { cart: string }, prefix = 'POS'): Promise<string> {
  const reserved = qr && reservedPosOrderNo(qr.cart);
  if (!reserved) return nextPosOrderNo(db, date, prefix);
  const [existing] = await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.orderNo, reserved)).limit(1);
  if (existing) throw new AppError(409, 'Yêu cầu QR đã được dùng cho một đơn hàng.');
  return reserved;
}
