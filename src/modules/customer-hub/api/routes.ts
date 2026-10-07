import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customerProfile } from '../../customers/api/routes.ts';
import { quotations } from '../../quotes/schema.ts';
import { quotationScope, type SqlScope } from '../../quotes/domain/access.ts';
import { customerPayments, deliveries, paymentSchedules, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';
import { debtCounts, quoteTotal, receivable, vietnamDate } from '../../sales/domain/sales.ts';
import { customerAccounts, customerStockRequests } from '../../portal/schema.ts';
import { HUB_LIMITS, purchaseHistory } from '../domain/overview.ts';

type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
/** Điều kiện SQL thô của quyền báo giá (alias `q`) → điều kiện drizzle trên bảng staff_quotations. */
const quotePredicate = (scope: SqlScope) => {
  const parts = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  return sql.join(parts.flatMap((p, i) => i < scope.bindings.length ? [sql.raw(p), sql`${scope.bindings[i]}`] : [sql.raw(p)]), sql.raw(''));
};

/**
 * Trang chi tiết khách hàng: gom một lượt mọi thứ liên quan tới khách
 * (hồ sơ, người liên hệ, nhân viên phụ trách / chia sẻ, báo giá, đơn, HĐKT, giao hàng, phiếu thu, công nợ, lịch sử mua, hỏi tồn, tài khoản).
 * Manager / người phụ trách / người được chia sẻ thấy toàn bộ; nhân viên khác chỉ thấy phần mình phụ trách hoặc tạo.
 */
export function registerCustomerHubRoutes(router: Router<StaffEnv>) {
  router.get('/customers/:id/overview', async c => {
    const db = c.env.db, me = viewer(c), id = c.params.id!;
    const profile = await customerProfile(db, id, me), all = profile.access.canSeeAll;
    const quoteWhere = and(sql`(${quotations.data}::jsonb ->> 'customerId') = ${id}`, all ? undefined : quotePredicate(quotationScope(me)));
    const [orders, quoteRows, stockRows, accountRows] = await Promise.all([
      db.select({ o: salesOrders, ownerName: employees.name }).from(salesOrders).innerJoin(employees, eq(employees.id, salesOrders.ownerId))
        .where(and(eq(salesOrders.customerId, id), all ? undefined : orderScopeFor(me)))
        .orderBy(desc(salesOrders.orderDate), desc(salesOrders.orderNo)).limit(HUB_LIMITS.orders),
      db.select({ q: quotations, assigneeName: employees.name }).from(quotations).innerJoin(employees, eq(employees.id, sql`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`))
        .where(quoteWhere).orderBy(desc(quotations.updatedAt)).limit(HUB_LIMITS.quotes),
      db.select({ id: customerStockRequests.id, status: customerStockRequests.status, items: customerStockRequests.items, note: customerStockRequests.note, createdAt: customerStockRequests.createdAt, answeredAt: customerStockRequests.answeredAt })
        .from(customerStockRequests).where(and(eq(customerStockRequests.customerId, id), all ? undefined : eq(customerStockRequests.ownerId, me.id)))
        .orderBy(desc(customerStockRequests.createdAt)).limit(HUB_LIMITS.stockRequests),
      db.select({ memberId: customerAccounts.memberId, name: employees.name, email: employees.email, active: employees.active, ownerId: customerAccounts.ownerId })
        .from(customerAccounts).innerJoin(employees, eq(employees.id, customerAccounts.memberId)).where(eq(customerAccounts.customerId, id)).orderBy(asc(employees.name)),
    ]);
    const ids = orders.map(r => r.o.id);
    const [lines, ships, sch, pays, cts] = ids.length ? await Promise.all([
      db.select({ orderId: salesOrderLines.orderId, sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, qty: salesOrderLines.qty, unitPrice: salesOrderLines.unitPrice, amount: salesOrderLines.amount })
        .from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
      db.select({ id: deliveries.id, orderId: deliveries.orderId, deliveryNo: deliveries.deliveryNo, plannedDate: deliveries.plannedDate, timeSlot: deliveries.timeSlot, status: deliveries.status, deliveredAt: deliveries.deliveredAt })
        .from(deliveries).where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))).orderBy(desc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      db.select({ id: customerPayments.id, orderId: customerPayments.orderId, amount: customerPayments.amount, paidAt: customerPayments.paidAt, method: customerPayments.method, reference: customerPayments.reference, note: customerPayments.note })
        .from(customerPayments).where(inArray(customerPayments.orderId, ids)).orderBy(desc(customerPayments.paidAt)),
      db.select({ id: salesContracts.id, orderId: salesContracts.orderId, contractNo: salesContracts.contractNo, status: salesContracts.status, signedDate: salesContracts.signedDate,
        value: salesContracts.value, legalEntity: salesContracts.legalEntity, updatedAt: salesContracts.updatedAt }).from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    ]) : [[], [], [], [], []];
    const today = vietnamDate().iso, orderNo = new Map(orders.map(r => [r.o.id, r.o.orderNo]));
    const orderList = orders.map(({ o, ownerName }) => {
      const k = cts.find(x => x.orderId === o.id && x.status !== 'cancelled'), counted = debtCounts(o.status, k?.status);
      return { id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, status: o.status, total: o.total, ownerName, quoteNo: o.quoteNo, expectedDeliveryDate: o.expectedDeliveryDate,
        contract: k ? { id: k.id, contractNo: k.contractNo, status: k.status } : null, counted,
        receivable: counted ? receivable(sch.filter(s => s.orderId === o.id), pays.filter(p => p.orderId === o.id), today) : null };
    });
    const counted = orderList.filter(o => o.counted), sum = (k: 'due' | 'paid' | 'balance' | 'overdue') => counted.reduce((s, o) => s + (o.receivable?.[k] ?? 0), 0);
    const confirmedIds = new Set(counted.map(o => o.id));
    const quotes = quoteRows.map(({ q, assigneeName }) => ({ id: q.id, quoteNo: q.quoteNo, quoteType: q.quoteType, quoteDate: q.quoteDate, approvalStatus: q.approvalStatus,
      total: quoteTotal(q.data), assigneeName, updatedAt: q.updatedAt, orderId: orders.find(r => r.o.quoteId === q.id && r.o.status !== 'cancelled')?.o.id ?? null }));
    const lastOrder = counted[0]?.orderDate ?? null;
    return json({
      ...profile,
      stats: {
        quotes: quotes.length, orders: counted.length, contracts: cts.filter(k => k.status !== 'cancelled').length,
        revenue: counted.reduce((s, o) => s + o.total, 0), due: sum('due'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue'),
        firstOrderDate: counted.at(-1)?.orderDate ?? null, lastOrderDate: lastOrder,
      },
      quotes,
      orders: orderList,
      contracts: cts.map(k => ({ ...k, orderNo: orderNo.get(k.orderId) ?? '' })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      deliveries: ships.map(d => ({ ...d, orderNo: orderNo.get(d.orderId) ?? '' })),
      payments: pays.map(p => ({ ...p, orderNo: orderNo.get(p.orderId) ?? '' })),
      purchases: purchaseHistory(lines.filter(l => confirmedIds.has(l.orderId)).map(l => ({ ...l, orderDate: orders.find(r => r.o.id === l.orderId)!.o.orderDate }))),
      stockRequests: stockRows.map(r => { let items: unknown[] = []; try { items = JSON.parse(r.items); } catch { /* bỏ qua */ } return { ...r, items: Array.isArray(items) ? items.length : 0 }; }),
      accounts: accountRows.map(a => ({ memberId: a.memberId, name: a.name, email: a.email, active: a.active })),
    });
  }, 'business');
}
