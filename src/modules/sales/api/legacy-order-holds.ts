import { and, asc, eq, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { productStock, warehouses } from '../../catalog/schema.ts';
import { stockMoves } from '../../inventory/schema.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { deliveries, packingSlips, salesContracts, salesOrderLines, salesOrders } from '../schema.ts';
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];

/** Same legacy reservation rules, with net issues aggregated once per eligible order/SKU.
 * Never cache this across requests: checkout/packing must read the current transaction.
 */
export function legacyOrderHoldsQuery(db: Db, skus?: string[], warehouseId?: string, storeScope?: SQL, complete = false) {
  const sapoCounted = and(sql`${salesOrders.sapoOrderId} IS NOT NULL`, or(isNull(salesOrders.sapoPushedAt), sql`EXISTS (${db.select({ one: sql`1` }).from(productStock)
    .innerJoin(warehouses, eq(warehouses.id, productStock.warehouseId))
    .where(and(eq(productStock.sku, salesOrderLines.sku), eq(warehouses.kind, 'stock'), gt(productStock.updatedAt, salesOrders.sapoPushedAt)))})`));
  // Đơn / HĐKT CRM đã trừ kho bán lúc duyệt (sổ kho) ở kho đã chốt đầu kỳ: tồn hiển thị đã trừ – không giữ thêm lần nữa.
  const openingQuery = db.selectDistinct({ warehouseId: stockMoves.warehouseId })
    .from(stockMoves).where(eq(stockMoves.refType, 'opening'));
  const openingWarehouses = db.$with('hold_opening_warehouses').as(openingQuery);
  const ledgerQuery = db.selectDistinct({ refId: stockMoves.refId }).from(stockMoves)
    .innerJoin(openingWarehouses, eq(openingWarehouses.warehouseId, stockMoves.warehouseId)).where(eq(stockMoves.refType, 'sales_order'));
  const ledgerRefs = db.$with('hold_ledger_refs').as(ledgerQuery);
  const ledgerCounted = sql`EXISTS (SELECT 1 FROM ${ledgerRefs} WHERE ${ledgerRefs.refId} = ${salesOrders.id} OR ${ledgerRefs.refId} LIKE ${salesOrders.id} || '#%')`;
  // Legacy POS orders often have no warehouse_id; their register still gives the exact selling warehouse.
  const sellingWarehouse = sql<string | null>`coalesce(${salesOrders.warehouseId}, (select ${posRegisters.warehouseId} from ${posShifts} join ${posRegisters} on ${posRegisters.id}=${posShifts.registerId} where ${posShifts.id}=${salesOrders.shiftId} and ${salesOrders.channel}='pos'))`;
  const linesQuery = db.select({
    sku: salesOrderLines.sku, qty: sql<number>`sum(${salesOrderLines.qty})`.as('qty'), deliveredQty: sql<number>`sum(${salesOrderLines.deliveredQty})`.as('delivered_qty'),
    orderId: salesOrders.id, orderNo: salesOrders.orderNo, quoteId: salesOrders.quoteId, customer: salesOrders.customerName,
    warehouseId: sellingWarehouse.as('selling_warehouse_id'),
    contractNo: sql<string | null>`max(${salesContracts.contractNo})`.as('contract_no'),
    /** Đơn chưa gắn kho bán (đơn cũ): giữ hàng trên tổng tồn mọi kho, không biết kho nào xuất. */
    unassigned: sql<boolean>`(${sellingWarehouse}) is null`.as('unassigned'),
  }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .leftJoin(salesContracts, and(eq(salesContracts.orderId, salesOrders.id), ne(salesContracts.status, 'cancelled')))
    .where(and(storeScope,
      // Unknown non-POS warehouse still retains its conservative global hold.
      warehouseId ? sql`(${sellingWarehouse}=${warehouseId} or ${sellingWarehouse} is null)` : undefined,
      // Đơn CRM giữ theo bảng order_stock_holds (≤ có thể bán) – chỉ đơn cũ chưa chuyển đổi và đơn POS dùng cách tính dưới.
      or(ne(salesOrders.channel, 'crm'), eq(salesOrders.holdMode, 'legacy')),
      eq(salesOrders.holdsStock, true), inArray(salesOrders.status, ['draft', 'confirmed', 'delivering']), ne(salesOrderLines.sku, ''),
      skus ? inArray(salesOrderLines.sku, skus) : undefined, sql`NOT (${sapoCounted})`, sql`NOT (${ledgerCounted})`))
    .groupBy(salesOrderLines.sku, salesOrders.id);
  const lines = db.$with('hold_order_lines').as(linesQuery);
  // Each move belongs to one reference type; UNION ALL preserves reverse moves and
  // avoids multiplying quantities when the order has duplicate SKU lines.
  const issuesQuery = db.select({
    orderId: sql<string>`issued.order_id`.as('order_id'), sku: sql<string>`issued.sku`.as('issued_sku'),
    qty: sql<number>`greatest(0,-sum(issued.qty))`.as('issued_qty'),
  }).from(sql`(
    select ${packingSlips.orderId} as order_id, ${stockMoves.sku} as sku, ${stockMoves.qty} as qty
    from ${stockMoves} join ${packingSlips} on ${packingSlips.id}=${stockMoves.refId}
    join ${lines} on ${lines.orderId}=${packingSlips.orderId} and ${lines.sku}=${stockMoves.sku}
    where ${stockMoves.refType}='packing_slip' ${warehouseId ? sql`and ${stockMoves.warehouseId}=${warehouseId}` : sql``}
    union all
    select ${deliveries.orderId}, ${stockMoves.sku}, ${stockMoves.qty}
    from ${stockMoves} join ${deliveries} on ${deliveries.id}=${stockMoves.refId}
    join ${lines} on ${lines.orderId}=${deliveries.orderId} and ${lines.sku}=${stockMoves.sku}
    where ${stockMoves.refType}='pos_delivery' ${warehouseId ? sql`and ${stockMoves.warehouseId}=${warehouseId}` : sql``}
  ) issued`).groupBy(sql`issued.order_id`, sql`issued.sku`);
  const issues = db.$with('hold_net_issues').as(issuesQuery);
  // Delivered units and issued units overlap. Subtract the larger, never their sum.
  const remaining = sql<number>`greatest(0,${lines.qty}-greatest(${lines.deliveredQty},coalesce(${issues.qty},0)))`;
  const resultQuery = db.select({
    sku: lines.sku, qty: remaining.as('remaining_qty'), orderId: lines.orderId, orderNo: lines.orderNo,
    quoteId: lines.quoteId, customer: lines.customer, warehouseId: lines.warehouseId,
    contractNo: lines.contractNo, unassigned: lines.unassigned,
  }).from(lines).leftJoin(issues, and(eq(issues.orderId, lines.orderId), eq(issues.sku, lines.sku)))
    .where(sql`${remaining}>0`).orderBy(asc(lines.sku), asc(lines.orderNo)).limit(complete ? 2147483647 : 5000);
  // Explicit materialization is important: with underestimated candidate counts PG
  // otherwise executes the same net-issue/ledger aggregates for each outer row.
  return db.select({
    sku: sql<string>`h.sku`, qty: sql<number>`h.remaining_qty`.mapWith(Number),
    orderId: sql<string>`h.id`, orderNo: sql<string>`h.order_no`, quoteId: sql<string | null>`h.quote_id`,
    customer: sql<string>`h.customer_name`, warehouseId: sql<string | null>`h.selling_warehouse_id`,
    contractNo: sql<string | null>`h.contract_no`, unassigned: sql<boolean>`h.unassigned`,
  }).from(sql`(with hold_opening_warehouses as materialized (${openingQuery}),
    hold_ledger_refs as materialized (${ledgerQuery}),
    hold_order_lines as materialized (${linesQuery}),
    hold_net_issues as materialized (${issuesQuery}) ${resultQuery}) h`)
    .orderBy(sql`h.sku`, sql`h.order_no`);
}
