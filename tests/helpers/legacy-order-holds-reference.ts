import { and, asc, eq, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { StaffEnv } from '../../src/modules/staff/api/auth-routes.ts';
import { productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { posRegisters, posShifts } from '../../src/modules/sales/pos-schema.ts';
import { deliveries, packingSlips, salesContracts, salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';
/** Query at d4533b58, retained solely as a before/after correctness oracle. */
export async function referenceLegacyHolds(db: StaffEnv['db'], skus?: string[], warehouseId?: string, storeScope?: SQL, complete=false) {
  const sapoCounted = and(sql`${salesOrders.sapoOrderId} IS NOT NULL`, or(isNull(salesOrders.sapoPushedAt), sql`EXISTS (${db.select({ one: sql`1` }).from(productStock)
    .innerJoin(warehouses, eq(warehouses.id, productStock.warehouseId))
    .where(and(eq(productStock.sku, salesOrderLines.sku), eq(warehouses.kind, 'stock'), gt(productStock.updatedAt, salesOrders.sapoPushedAt)))})`));
  // Đơn / HĐKT CRM đã trừ kho bán lúc duyệt (sổ kho) ở kho đã chốt đầu kỳ: tồn hiển thị đã trừ – không giữ thêm lần nữa.
  const ledgerCounted = sql`EXISTS (SELECT 1 FROM ${stockMoves} m WHERE m.ref_type = 'sales_order' AND (m.ref_id = ${salesOrders.id} OR m.ref_id LIKE ${salesOrders.id} || '#%')
    AND EXISTS (SELECT 1 FROM ${stockMoves} o WHERE o.warehouse_id = m.warehouse_id AND o.ref_type = 'opening'))`;
  // Legacy POS orders often have no warehouse_id; their register still gives the exact selling warehouse.
  const sellingWarehouse = sql<string | null>`coalesce(${salesOrders.warehouseId}, (select ${posRegisters.warehouseId} from ${posShifts} join ${posRegisters} on ${posRegisters.id}=${posShifts.registerId} where ${posShifts.id}=${salesOrders.shiftId} and ${salesOrders.channel}='pos'))`;
  // Issued stock has already reduced stock_balances. Delivered quantities and issued moves may describe
  // the same units, so subtract their maximum, never both. Reverse moves reduce net issued quantity.
  const legacyIssued = sql`coalesce((select greatest(0,-sum(${stockMoves.qty})) from ${stockMoves}
    where ${stockMoves.sku}=${salesOrderLines.sku} ${warehouseId ? sql`and ${stockMoves.warehouseId}=${warehouseId}` : sql``}
      and ((${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} where ${packingSlips.id}=${stockMoves.refId} and ${packingSlips.orderId}=${salesOrders.id}))
        or (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} where ${deliveries.id}=${stockMoves.refId} and ${deliveries.orderId}=${salesOrders.id})))),0)`;
  // Origin labels never release a reservation: only actual stock issues/delivery do.
  const legacyRemaining = sql`greatest(0,sum(${salesOrderLines.qty})-greatest(sum(${salesOrderLines.deliveredQty}),max(${legacyIssued})))`;
  const legacy = await db.select({
    sku: salesOrderLines.sku, qty: sql<number>`${legacyRemaining}`.mapWith(Number),
    orderId: salesOrders.id, orderNo: salesOrders.orderNo, quoteId: salesOrders.quoteId, customer: salesOrders.customerName,
    warehouseId: sellingWarehouse,
    contractNo: sql<string | null>`max(${salesContracts.contractNo})`,
    /** Đơn chưa gắn kho bán (đơn cũ): giữ hàng trên tổng tồn mọi kho, không biết kho nào xuất. */
    unassigned: sql<boolean>`(${sellingWarehouse}) is null`,
  }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .leftJoin(salesContracts, and(eq(salesContracts.orderId, salesOrders.id), ne(salesContracts.status, 'cancelled')))
    .where(and(storeScope,
      // Unknown non-POS warehouse still retains its conservative global hold.
      warehouseId ? sql`(${sellingWarehouse}=${warehouseId} or ${sellingWarehouse} is null)` : undefined,
      // Đơn CRM giữ theo bảng order_stock_holds (≤ có thể bán) – chỉ đơn cũ chưa chuyển đổi và đơn POS dùng cách tính dưới.
      or(ne(salesOrders.channel, 'crm'), eq(salesOrders.holdMode, 'legacy')),
      eq(salesOrders.holdsStock, true), inArray(salesOrders.status, ['draft', 'confirmed', 'delivering']), ne(salesOrderLines.sku, ''),
      skus ? inArray(salesOrderLines.sku, skus) : undefined, sql`NOT (${sapoCounted})`, sql`NOT (${ledgerCounted})`))
    .groupBy(salesOrderLines.sku, salesOrders.id).having(sql`${legacyRemaining}>0`).orderBy(asc(salesOrderLines.sku), asc(salesOrders.orderNo)).limit(complete ? 2147483647 : 5000);
  return legacy;
}
