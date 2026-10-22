import { inArray } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { supplierReceipts } from '../schema.ts';

/** Sổ kho (#/stock-moves): phiếu nhận hàng NCC (PNH…) → mở đơn mua của phiếu. Gắn vào stockRefLinkHooks ở src/app/router.ts. */
export async function supplierReceiptStockLinks(db: StaffEnv['db'], ids: readonly string[]) {
  const rows = await db.select({ id: supplierReceipts.id, shipmentId: supplierReceipts.shipmentId }).from(supplierReceipts).where(inArray(supplierReceipts.id, [...ids]));
  return new Map(rows.map(r => [r.id, `#/purchases/${encodeURIComponent(r.shipmentId)}`]));
}
