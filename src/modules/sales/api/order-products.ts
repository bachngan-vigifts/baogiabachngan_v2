import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import type { OrderProductsResponse, OrderProductTrip } from '../../../core/contracts/order-products.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { products } from '../../catalog/schema.ts';
import { salesOrders, salesOrderLines, salesContracts, deliveries, deliveryLines } from '../schema.ts';
import { vietnamDate } from '../domain/sales.ts';
import { ORDER_STATUSES } from '../domain/statuses.ts';
import { progressOf } from './progress.ts';

type Member = SessionState['member'];
export function registerOrderProductsRoutes(router: Router<StaffEnv>, scopeFor: (member: Member) => SQL | undefined) {
  router.get('/order-products', async c => {
    const db = c.env.db, member = (c.state.session as SessionState).member, sp = c.url.searchParams;
    const text = (key: string) => { const value = (sp.get(key) || '').trim(); if (value.length > 200) throw new AppError(400, 'Nội dung bộ lọc quá dài.'); return value; };
    const status = text('status') || 'work', q = text('q'), owner = text('owner'), kind = text('kind'), channel = text('channel'), orderStatus = text('orderStatus');
    const from = text('from'), to = text('to'), sort = text('sort') || 'due';
    const integer = (key: string, fallback: number, max: number) => { const raw = sp.get(key); const n = raw === null ? fallback : Number(raw); if (!Number.isInteger(n) || n < 0 || n > max || (key === 'limit' && n === 0)) throw new AppError(400, 'Phân trang không hợp lệ.'); return n; };
    const limit = integer('limit', 50, 200), offset = integer('offset', 0, 10000000);
    const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s;
    if ((from && !date(from)) || (to && !date(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng hạn giao không hợp lệ.');
    if (!['all','work','partial','overdue','unscheduled','delivered'].includes(status) || !['','order','contract'].includes(kind) || !['','crm','pos'].includes(channel) || !['due','updated','customer','owner'].includes(sort) || (orderStatus && !(ORDER_STATUSES as readonly string[]).includes(orderStatus))) throw new AppError(400, 'Bộ lọc sản phẩm theo đơn không hợp lệ.');
    const today = vietnamDate().iso;
    const scheduled = db.select({ lineId: deliveryLines.orderLineId,
      qty: sql<number>`sum(${deliveryLines.qty})`.mapWith(Number).as('scheduled_qty'),
      date: sql<string>`min(${deliveries.plannedDate})`.as('scheduled_date') })
      .from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId)).innerJoin(salesOrders,eq(salesOrders.id,deliveries.orderId))
      .where(and(scopeFor(member),inArray(deliveries.status,['planned','in_transit']))).groupBy(deliveryLines.orderLineId).as('line_schedule');
    const remaining = sql<number>`greatest(0,${salesOrderLines.qty}-${salesOrderLines.deliveredQty})`.mapWith(Number);
    const reserved = sql<number>`coalesce(${scheduled.qty},0)`.mapWith(Number);
    const available = sql<number>`greatest(0,${remaining}-${reserved})`.mapWith(Number);
    const due = sql<string | null>`case when ${available} > 0.000000001 and nullif(${salesOrders.expectedDeliveryDate},'') is not null
      then least(coalesce(${scheduled.date},${salesOrders.expectedDeliveryDate}),${salesOrders.expectedDeliveryDate}) else ${scheduled.date} end`;
    const overdue = and(gt(remaining,1e-9),ne(salesOrders.status,'cancelled'),sql`${due} < ${today}`)!;
    const predicates = { all: sql`true`, work: gt(remaining,1e-9)!, partial: and(gt(salesOrderLines.deliveredQty,1e-9),gt(remaining,1e-9))!, overdue,
      unscheduled: gt(available,1e-9)!, delivered: sql`${remaining} <= 0.000000001` };
    const base = and(scopeFor(member), orderStatus ? eq(salesOrders.status,orderStatus as never) : ne(salesOrders.status,'cancelled'),
      owner ? eq(salesOrders.ownerId,owner) : undefined,
      kind === 'contract' ? isNotNull(salesContracts.id) : kind === 'order' ? isNull(salesContracts.id) : undefined,
      channel === 'pos' ? eq(salesOrders.channel,'pos') : channel === 'crm' ? ne(salesOrders.channel,'pos') : undefined,
      from ? gte(due,from) : undefined, to ? lte(due,to) : undefined,
      matchAllWords(foldSql(salesOrderLines.sku,salesOrderLines.name,salesOrders.orderNo,salesContracts.contractNo,salesOrders.customerName),q));
    const fields = { id:salesOrderLines.id,orderId:salesOrders.id,orderNo:salesOrders.orderNo,contractNo:salesContracts.contractNo,
      customerName:salesOrders.customerName,ownerId:salesOrders.ownerId,ownerName:employees.name,channel:salesOrders.channel,orderStatus:salesOrders.status,
      sku:salesOrderLines.sku,name:salesOrderLines.name,unit:salesOrderLines.unit,imageUrl:products.imageUrl,qty:salesOrderLines.qty,deliveredQty:salesOrderLines.deliveredQty,
      scheduledQty:reserved,remainingQty:remaining,availableQty:available,nextDeliveryDate:due,expectedDeliveryDate:salesOrders.expectedDeliveryDate,
      unitPrice:salesOrderLines.unitPrice,taxRate:salesOrderLines.taxRate,amount:salesOrderLines.amount };
    const countIf = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
    const [[counts], rows, owners] = await Promise.all([
      db.select({all:count(),work:countIf(predicates.work),partial:countIf(predicates.partial),overdue:countIf(overdue),unscheduled:countIf(predicates.unscheduled),delivered:countIf(predicates.delivered)})
        .from(salesOrderLines).innerJoin(salesOrders,eq(salesOrders.id,salesOrderLines.orderId)).leftJoin(salesContracts,eq(salesContracts.orderId,salesOrders.id)).leftJoin(scheduled,eq(scheduled.lineId,salesOrderLines.id)).where(base),
      db.select(fields).from(salesOrderLines).innerJoin(salesOrders,eq(salesOrders.id,salesOrderLines.orderId)).leftJoin(salesContracts,eq(salesContracts.orderId,salesOrders.id))
        .leftJoin(employees,eq(employees.id,salesOrders.ownerId)).leftJoin(products,eq(products.sku,salesOrderLines.sku)).leftJoin(scheduled,eq(scheduled.lineId,salesOrderLines.id))
        .where(and(base,predicates[status as keyof typeof predicates]))
        .orderBy(...(sort==='updated'?[desc(salesOrders.updatedAt)]:sort==='customer'?[asc(salesOrders.customerName)]:sort==='owner'?[asc(employees.name)]:[sql`${due} asc nulls last`]),asc(salesOrders.id),asc(salesOrderLines.lineNo),asc(salesOrderLines.id)).limit(limit).offset(offset),
      db.selectDistinct({id:employees.id,name:employees.name}).from(salesOrders).innerJoin(salesOrderLines,eq(salesOrderLines.orderId,salesOrders.id))
        .innerJoin(employees,eq(employees.id,salesOrders.ownerId)).where(scopeFor(member)).orderBy(asc(employees.name)),
    ]);
    const ids = rows.map(r=>r.id), orderIds = [...new Set(rows.map(r=>r.orderId))];
    const [trips, progress] = await Promise.all([
      ids.length ? db.select({lineId:deliveryLines.orderLineId,id:deliveries.id,deliveryNo:deliveries.deliveryNo,plannedDate:deliveries.plannedDate,timeSlot:deliveries.timeSlot,status:deliveries.status,qty:deliveryLines.qty,
          carrier:deliveries.carrier,trackingCode:deliveries.trackingCode,trackingStatus:deliveries.trackingStatus})
        .from(deliveryLines).innerJoin(deliveries,eq(deliveries.id,deliveryLines.deliveryId)).where(inArray(deliveryLines.orderLineId,ids)).orderBy(asc(deliveries.plannedDate),asc(deliveries.id)) : [],
      progressOf(db,orderIds),
    ]);
    const byLine = new Map<string,OrderProductTrip[]>();
    for (const trip of trips) { const list = byLine.get(trip.lineId) || []; const {lineId,...data}=trip; list.push(data); byLine.set(lineId,list); }
    const warehouse = member.role === 'employee' && member.positionId === 'warehouse';
    const summary = counts || {all:0,work:0,partial:0,overdue:0,unscheduled:0,delivered:0};
    const response: OrderProductsResponse = { scope:'native-orders',calculatedDate:today,limit,offset,counts:summary,total:summary[status as keyof typeof summary],filterOptions:{owners},
      lines:rows.map(r=>{
        const {unitPrice,taxRate,amount,...rest}=r,p=progress.get(r.orderId);
        return {...rest,ownerName:r.ownerName||'',imageUrl:r.imageUrl||'',...(!warehouse?{unitPrice,taxRate,amount}:{}),
          overdue:r.remainingQty>1e-9&&r.orderStatus!=='cancelled'&&!!r.nextDeliveryDate&&r.nextDeliveryDate<today,
          canSchedule:!warehouse&&can(member,r.contractNo?'page.contracts':'page.orders')&&!['draft','cancelled','delivered'].includes(r.orderStatus)&&r.availableQty>1e-9,
          progress:p?{label:p.label,current:p.current}:null,trips:byLine.get(r.id)||[]};
      }) };
    return json(response);
  }, 'business');
}
