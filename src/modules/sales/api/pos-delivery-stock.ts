import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { postMoves, type LedgerDb } from '../../inventory/api/ledger.ts';
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
  const [row] = await db
    .select({ o: salesOrders, warehouseId: posRegisters.warehouseId })
    .from(salesOrders)
    .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.channel, 'pos')));
  if (!row) return;
  const lines = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId));
  const skus = [...new Set(lines.map((l) => l.sku))].sort();
  const balances = await db
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.warehouseId, row.warehouseId),
        inArray(stockBalances.sku, skus),
      ),
    )
    .orderBy(asc(stockBalances.sku))
    .for('update');
  const issued = await db
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
    ? await db
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
    if ((balances.find((x) => x.sku === sku)?.qty ?? 0) < need)
      throw new AppError(409, 'Kho không đủ hàng để xác nhận giao COD: ' + sku);
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
  await postMoves(db, actorId, moves);
}
