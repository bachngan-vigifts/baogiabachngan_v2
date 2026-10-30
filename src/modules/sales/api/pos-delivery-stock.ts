import { pendingGhnEdit } from '../domain/pos-ghn-edit.ts';
import { AppError } from '../../../core/errors.ts';
import { and, eq, sql } from 'drizzle-orm';
import { stockMoves } from '../../inventory/schema.ts';
import { postMoves, lockLedger, assertWarehousesOpened, type LedgerDb } from '../../inventory/api/ledger.ts';
import {
  salesOrders,
  salesOrderLines,
  packingSlips,
  deliveries,
  deliveryLines,
} from '../schema.ts';
import { posShifts, posRegisters } from '../pos-schema.ts';
/** COD issues when delivered; prepaid shipping may issue at dispatch. Existing packing/dispatch debits are always subtracted once. */
export async function issuePosDelivery(
  db: LedgerDb,
  orderId: string,
  deliveryId: string,
  actorId: string,
  dispatch = false,
) {
  return db.transaction(async tx => {
  await lockLedger(tx);
  const [row] = await tx
    .select({ o: salesOrders, warehouseId: posRegisters.warehouseId })
    .from(salesOrders)
    .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.channel, 'pos')));
  if (!row) return;
  if (pendingGhnEdit(row.o.posSnapshot)) throw new AppError(409, 'Đơn đang chờ hoàn tất sửa GHN; chưa xuất kho.', 'GHN_EDIT_PENDING');
  await assertWarehousesOpened(tx, [row.warehouseId]);
  const lines = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId));
  const skus = [...new Set(lines.map((l) => l.sku))].sort();
  const issued = await tx
    .select({
      sku: stockMoves.sku,
      qty: sql<number>`-sum(${stockMoves.qty})`.mapWith(Number),
    })
    .from(stockMoves)
    .where(
      and(
        eq(stockMoves.warehouseId, row.warehouseId),
        sql`(${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} where ${packingSlips.id}=${stockMoves.refId} and ${packingSlips.orderId}=${orderId})) or (${stockMoves.warehouseId}=${row.warehouseId} and ${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} where ${deliveries.id}=${stockMoves.refId} and ${deliveries.orderId}=${orderId}))`,
      ),
    )
    .groupBy(stockMoves.sku);
  const dispatched = dispatch
    ? await tx
        .select({
          sku: salesOrderLines.sku,
          qty: sql<number>`sum(${deliveryLines.qty})`.mapWith(Number),
        })
        .from(deliveryLines)
        .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
        .innerJoin(
          salesOrderLines,
          eq(salesOrderLines.id, deliveryLines.orderLineId),
        )
        .where(
          and(
            eq(deliveries.orderId, orderId),
            sql`(${deliveries.status} in ('in_transit','delivered') or exists(select 1 from ${stockMoves} where ${stockMoves.refType}='pos_delivery' and ${stockMoves.refId}=${deliveries.id}))`,
          ),
        )
        .groupBy(salesOrderLines.sku)
    : [];
  const moves = skus.flatMap((sku) => {
    const need =
      (dispatch
        ? dispatched.find((l) => l.sku === sku)?.qty || 0
        : lines
            .filter((l) => l.sku === sku)
            .reduce((n, l) => n + l.deliveredQty, 0)) -
      (issued.find((x) => x.sku === sku)?.qty ?? 0);
    if (need <= 1e-9) return [];
    return [
      {
        sku,
        warehouseId: row.warehouseId,
        qty: -need,
        kind: 'issue' as const,
        refType: 'pos_delivery' as const,
        refId: deliveryId,
        refNo: row.o.orderNo,
      },
    ];
  });
  await postMoves(tx, actorId, moves);
  });
}
