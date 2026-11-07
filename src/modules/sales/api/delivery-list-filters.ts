import { and, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { deliveries, deliveryLines, salesContracts, salesOrderLines, salesOrders } from '../schema.ts';

/** Filters execute before the result limit, within the caller's existing delivery scope. */
export function deliveryListFilters(sp: URLSearchParams, today: string): SQL | undefined {
  const get = (key: string) => {
    const value = (sp.get(key) || '').trim();
    if (value.length > 200) throw new AppError(400, 'Nội dung bộ lọc quá dài.');
    return value;
  };
  const pattern = (value: string) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
  const q = get('q'), product = get('product'), customer = get('customer'), receiver = get('receiver'), address = get('address'), assignee = get('assignee');
  const due = get('due'), tracking = get('tracking'), confirmation = get('confirmation');
  for (const [value, allowed] of [[due, ['', 'overdue', 'today', 'next7', 'no-time']], [tracking, ['', 'yes', 'no']], [confirmation, ['', 'yes', 'no']]] as const)
    if (!(allowed as readonly string[]).includes(value)) throw new AppError(400, 'Bộ lọc giao hàng không hợp lệ.');
  const pending = sql`${deliveries.status} in ('planned','in_transit','failed')`;
  return and(
    q ? ilike(sql`concat_ws(' ',${deliveries.deliveryNo},${salesOrders.orderNo},${salesContracts.contractNo},${salesOrders.customerName},${deliveries.trackingCode},${deliveries.note})`, pattern(q)) : undefined,
    customer ? ilike(salesOrders.customerName, pattern(customer)) : undefined,
    receiver ? ilike(sql`concat_ws(' ',${deliveries.receiverName},${deliveries.receiverPhone},${salesOrders.contact},${salesOrders.phone})`, pattern(receiver)) : undefined,
    address ? ilike(sql`coalesce(nullif(${deliveries.address},''),${salesOrders.address})`, pattern(address)) : undefined,
    assignee ? eq(deliveries.assigneeId, assignee) : undefined,
    product ? sql`exists (select 1 from ${deliveryLines} dl inner join ${salesOrderLines} ol on ol.id=dl.order_line_id where dl.delivery_id="deliveries"."id" and ${ilike(sql`concat_ws(' ',ol.sku,ol.name)`, pattern(product))})` : undefined,
    due === 'overdue' ? and(pending, sql`${deliveries.plannedDate} < ${today}`) : undefined,
    due === 'today' ? eq(deliveries.plannedDate, today) : undefined,
    due === 'next7' ? and(pending, sql`${deliveries.plannedDate} >= ${today}`, sql`${deliveries.plannedDate} <= (${today}::date + 6)::text`) : undefined,
    due === 'no-time' ? sql`trim(${deliveries.timeSlot}) = ''` : undefined,
    tracking ? sql`(trim(${deliveries.trackingCode}) <> '') = ${tracking === 'yes'}` : undefined,
    confirmation ? sql`(${deliveries.confirmedAt} is not null) = ${confirmation === 'yes'}` : undefined,
  );
}
