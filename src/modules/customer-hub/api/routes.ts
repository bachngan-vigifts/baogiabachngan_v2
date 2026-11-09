import type {CatalogueCustomerLinks} from '../../../core/contracts/catalogue-customer.ts';
import { registerCustomerCenterRoutes } from './center.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { netReceivables } from '../../sales/api/pos-return-credit.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { and, asc, desc, eq, inArray, isNull, or, ne, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customerProfile } from '../../customers/api/routes.ts';
import { quotations } from '../../quotes/schema.ts';
import { customerPayments, deliveries, paymentSchedules, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';
import { debtCounts, quoteTotal, vietnamDate } from '../../sales/domain/sales.ts';
import { customerAccounts, customerStockRequests } from '../../portal/schema.ts';
import { HUB_LIMITS, purchaseHistory } from '../domain/overview.ts';
import { parseDiscounts, shownEmail } from '../../portal/domain/portal.ts';
import { customerActivities } from '../../care/schema.ts';
import { careScope } from '../../care/api/routes.ts';
import { CARE_REMIND_LABEL, CARE_RESULT_LABEL, CARE_TYPE_LABEL } from '../../care/domain/care.ts';

type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
/** Điều kiện SQL thô của quyền báo giá (alias `q`) → điều kiện drizzle trên bảng staff_quotations. */


/**
 * Trang chi tiết khách hàng: gom một lượt mọi thứ liên quan tới khách
 * (hồ sơ, người liên hệ, nhân viên phụ trách / chia sẻ, báo giá, đơn, HĐKT, giao hàng, phiếu thu, công nợ, lịch sử mua, hỏi tồn, tài khoản).
 * Manager / người phụ trách / người được chia sẻ thấy toàn bộ; nhân viên khác chỉ thấy phần mình phụ trách hoặc tạo.
 */
export function registerCustomerHubRoutes(router: Router<StaffEnv>, catalogue?: CatalogueCustomerLinks) {
  registerCustomerCenterRoutes(router);
  router.get('/customers/:id/overview', async c => {
    const db = c.env.db, me = viewer(c), id = c.params.id!;
    const profile = await customerProfile(db, id, me), all = profile.access.canSeeAll;
    const quoteWhere = and(sql`(${quotations.data}::jsonb ->> 'customerId') = ${id}`, all ? undefined : quotationPredicate(me));
    const [orders, quoteRows, stockRows, accountRows, careRows, catalogueQuotes] = await Promise.all([
      db.select({ o: salesOrders, ownerName: employees.name }).from(salesOrders).innerJoin(employees, eq(employees.id, salesOrders.ownerId))
        .where(and(eq(salesOrders.customerId, id), all ? undefined : orderScopeFor(me)))
        .orderBy(desc(salesOrders.orderDate), desc(salesOrders.orderNo)).limit(HUB_LIMITS.orders),
      db.select({ q: quotations, assigneeName: employees.name }).from(quotations).innerJoin(employees, eq(employees.id, sql`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`))
        .where(quoteWhere).orderBy(desc(quotations.updatedAt)).limit(HUB_LIMITS.quotes),
      db.select({ id: customerStockRequests.id, status: customerStockRequests.status, items: customerStockRequests.items, note: customerStockRequests.note, createdAt: customerStockRequests.createdAt, answeredAt: customerStockRequests.answeredAt })
        .from(customerStockRequests).where(and(eq(customerStockRequests.customerId, id), all ? undefined : or(eq(customerStockRequests.ownerId, me.id), departmentOwner(customerStockRequests.ownerId, me))))
        .orderBy(desc(customerStockRequests.createdAt)).limit(HUB_LIMITS.stockRequests),
      // Tài khoản trang khách (tên, email / SĐT đăng nhập, chiết khấu riêng): chỉ Manager / người phụ trách / người được chia sẻ khách mới xem.
      all ? db.select({ memberId: customerAccounts.memberId, name: employees.name, email: employees.email, phone: employees.phone, active: employees.active, discounts: customerAccounts.discounts })
        .from(customerAccounts).innerJoin(employees, eq(employees.id, customerAccounts.memberId)).where(eq(customerAccounts.customerId, id)).orderBy(asc(employees.name)) : Promise.resolve([]),
      // Nhật ký chăm sóc: nhân viên chỉ thấy lần mình ghi, Manager thấy tất cả (như trang Chăm sóc KH).
      db.select({ a: customerActivities, ownerName: employees.name }).from(customerActivities).innerJoin(employees, eq(employees.id, customerActivities.ownerId))
        .where(and(eq(customerActivities.customerId, id), careScope(me))).orderBy(desc(customerActivities.occurredAt)).limit(HUB_LIMITS.care),
      catalogue?catalogue.list(db,me,id,all):Promise.resolve([]),
    ]);
    const ids = orders.map(r => r.o.id);
    const [lines, ships, sch, pays, cts] = ids.length ? await Promise.all([
      db.select({ orderId: salesOrderLines.orderId, sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, qty: salesOrderLines.qty, unitPrice: salesOrderLines.unitPrice, amount: salesOrderLines.amount })
        .from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
      db.select({ id: deliveries.id, orderId: deliveries.orderId, deliveryNo: deliveries.deliveryNo, plannedDate: deliveries.plannedDate, timeSlot: deliveries.timeSlot, status: deliveries.status, deliveredAt: deliveries.deliveredAt })
        .from(deliveries).where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))).orderBy(desc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      db.select({ id: customerPayments.id, orderId: customerPayments.orderId, amount: customerPayments.amount, paidAt: customerPayments.paidAt, method: customerPayments.method, reference: customerPayments.reference, note: customerPayments.note })
        .from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))).orderBy(desc(customerPayments.paidAt)),
      db.select({ id: salesContracts.id, orderId: salesContracts.orderId, contractNo: salesContracts.contractNo, status: salesContracts.status, signedDate: salesContracts.signedDate,
        value: salesContracts.value, legalEntity: salesContracts.legalEntity, updatedAt: salesContracts.updatedAt }).from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    ]) : [[], [], [], [], []];
    // Bản ghi có HĐKT là HĐKT (luồng riêng): giao hàng / phiếu thu / báo giá kèm số HĐKT để hiện thay số đơn.
    const today = vietnamDate().iso, orderNo = new Map(orders.map(r => [r.o.id, r.o.orderNo])), contractNo = new Map(cts.map(k => [k.orderId, k.contractNo]));
    const net = await netReceivables(db, ids, today); // công nợ đã trừ hàng khách trả (như trang Công nợ)
    const orderList = orders.map(({ o, ownerName }) => {
      const k = cts.find(x => x.orderId === o.id && x.status !== 'cancelled'), counted = debtCounts(o.status, k?.status);
      return { id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, status: o.status, total: o.total, ownerName, quoteNo: o.quoteNo, expectedDeliveryDate: o.expectedDeliveryDate,
        contract: k ? { id: k.id, contractNo: k.contractNo, status: k.status } : null, counted,
        receivable: counted ? net.get(o.id)! : null };
    });
    const counted = orderList.filter(o => o.counted), sum = (k: 'due' | 'paid' | 'balance' | 'overdue') => counted.reduce((s, o) => s + (o.receivable?.[k] ?? 0), 0);
    const confirmedIds = new Set(counted.map(o => o.id));
    const quotes = quoteRows.map(({ q, assigneeName }) => ({ id: q.id, quoteNo: q.quoteNo, quoteType: q.quoteType, quoteDate: q.quoteDate, approvalStatus: q.approvalStatus,
      total: quoteTotal(q.data), assigneeName, updatedAt: q.updatedAt, orderId: orders.find(r => r.o.quoteId === q.id && r.o.status !== 'cancelled')?.o.id ?? null }))
      .map(q => ({ ...q, contractNo: q.orderId ? contractNo.get(q.orderId) ?? null : null }));
    const lastOrder = counted[0]?.orderDate ?? null;
    return json({
      ...profile,
      stats: {
        quotes: quotes.length, orders: counted.length, contracts: cts.filter(k => k.status !== 'cancelled').length,
        revenue: counted.reduce((s, o) => s + o.total, 0), due: sum('due'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue'),
        firstOrderDate: counted.at(-1)?.orderDate ?? null, lastOrderDate: lastOrder,
      },
      quotes, catalogueQuotes,
      orders: orderList,
      contracts: cts.map(k => ({ ...k, orderNo: orderNo.get(k.orderId) ?? '' })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      deliveries: ships.map(d => ({ ...d, orderNo: orderNo.get(d.orderId) ?? '', contractNo: contractNo.get(d.orderId) ?? null })),
      payments: pays.map(p => ({ ...p, orderNo: orderNo.get(p.orderId) ?? '', contractNo: contractNo.get(p.orderId) ?? null })),
      purchases: purchaseHistory(lines.filter(l => confirmedIds.has(l.orderId)).map(l => ({ ...l, orderDate: orders.find(r => r.o.id === l.orderId)!.o.orderDate }))),
      stockRequests: stockRows.map(r => { let items: unknown[] = []; try { items = JSON.parse(r.items); } catch { /* bỏ qua */ } return { ...r, items: Array.isArray(items) ? items.length : 0 }; }),
      care: careRows.map(({ a, ownerName }) => ({ ...a, ownerName, typeLabel: CARE_TYPE_LABEL[a.type], resultLabel: CARE_RESULT_LABEL[a.result], remindLabel: CARE_REMIND_LABEL[a.remindBefore], canEdit: me.role === 'manager' || a.ownerId === me.id })),
      accounts: accountRows.map(a => ({ memberId: a.memberId, name: a.name, email: shownEmail(a.email), phone: a.phone ?? '', active: a.active, discounts: parseDiscounts(a.discounts) })),
    });
  }, 'business');
}

