import { departmentOwner } from '../../staff/api/department.ts';
import { netReceivables } from '../../sales/api/pos-return-credit.ts';
import { and, asc, desc, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positions } from '../../staff/schema.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { customerPayments, paymentSchedules, salesContracts, salesOrders } from '../../sales/schema.ts';
import { debtCounts, quoteTotal, vietnamDate } from '../../sales/domain/sales.ts';
import { tasks } from '../../tasks/schema.ts';
import { payrollOf } from '../../hr/api/routes.ts';
import { isMonth, monthRange, shiftMonth, targetPercent } from '../../hr/domain/payroll.ts';
import { STAFF_HUB_LIMITS, monthOf, percent, revenueIn, trend } from '../domain/kpi.ts';

type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
/** Ngày của báo giá để xếp vào tháng: ngày báo giá, không có thì ngày tạo. */
const quoteDay = sql<string>`coalesce(nullif(${quotations.quoteDate}, ''), substr(${quotations.createdAt}, 1, 10))`;
const quoteOwner = sql`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`;

/** Đơn nhân viên phụ trách (mới nhất trước) kèm cờ "đã tính công nợ" theo HĐKT. */
async function ordersOf(db: AnyDb, memberId: string, from?: string, to?: string) {
  const orders = await db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, orderDate: salesOrders.orderDate, status: salesOrders.status, total: salesOrders.total,
    customerId: salesOrders.customerId, customerName: salesOrders.customerName, quoteId: salesOrders.quoteId, quoteNo: salesOrders.quoteNo })
    .from(salesOrders).where(and(eq(salesOrders.ownerId, memberId), from ? gte(salesOrders.orderDate, from) : undefined, to ? lt(salesOrders.orderDate, to) : undefined))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.orderNo)).limit(STAFF_HUB_LIMITS.orders);
  const ids = orders.map(o => o.id);
  const contracts = ids.length ? await db.select({ id: salesContracts.id, orderId: salesContracts.orderId, contractNo: salesContracts.contractNo, status: salesContracts.status,
    signedDate: salesContracts.signedDate, value: salesContracts.value, legalEntity: salesContracts.legalEntity, customerId: salesContracts.customerId, updatedAt: salesContracts.updatedAt })
    .from(salesContracts).where(inArray(salesContracts.orderId, ids)) : [];
  const active = (orderId: string) => contracts.find(k => k.orderId === orderId && k.status !== 'cancelled');
  return { orders: orders.map(o => ({ ...o, counted: debtCounts(o.status, active(o.id)?.status), contract: active(o.id) ?? null })), contracts };
}

/**
 * Doanh số theo người phụ trách và tháng (cùng định nghĩa KPI: đơn đã tính công nợ, gồm VAT) – bơm vào module hr
 * cho thưởng KPI DS / thưởng quý. Map<memberId, { 'YYYY-MM': số tiền }>.
 */
export async function memberRevenues(db: AnyDb, months: readonly string[]) {
  const sorted = [...months].sort(), from = monthRange(sorted[0]!).from, to = monthRange(sorted.at(-1)!).next;
  const orders = await db.select({ id: salesOrders.id, ownerId: salesOrders.ownerId, orderDate: salesOrders.orderDate, status: salesOrders.status, total: salesOrders.total })
    .from(salesOrders).where(and(gte(salesOrders.orderDate, from), lt(salesOrders.orderDate, to)));
  const contracts = orders.length ? await db.select({ orderId: salesContracts.orderId, status: salesContracts.status }).from(salesContracts)
    .where(inArray(salesContracts.orderId, orders.map(o => o.id))) : [];
  const out = new Map<string, Record<string, number>>();
  for (const o of orders) {
    const k = contracts.find(x => x.orderId === o.id && x.status !== 'cancelled'), m = monthOf(o.orderDate);
    if (!months.includes(m) || !debtCounts(o.status, k?.status)) continue;
    const rec = out.get(o.ownerId) ?? {}; rec[m] = (rec[m] ?? 0) + o.total; out.set(o.ownerId, rec);
  }
  return out;
}

/**
 * Trang chi tiết nhân viên: gom một lượt hồ sơ, KPI tháng, khách hàng, báo giá, đơn, HĐKT, giao dịch (phiếu thu), công nợ,
 * công việc, ngày công, lương / thưởng. Manager xem mọi nhân viên; đồng nghiệp cùng nhóm xem nghiệp vụ, không đọc dữ liệu lương.
 */
export function registerStaffHubRoutes(router: Router<StaffEnv>) {
  router.get('/members/:id/overview', async c => {
    const db = c.env.db, me = viewer(c), id = c.params.id!;
    const canViewPayroll = me.id === id || me.role === 'manager';
    if (!canViewPayroll) {
      const [peer] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), departmentOwner(employees.id, me) ?? sql`false`)).limit(1);
      if (!peer) throw new AppError(403, 'Bạn chỉ xem được hồ sơ của mình và đồng nghiệp cùng phòng ban.');
    }
    const today = vietnamDate().iso, qMonth = c.url.searchParams.get('month');
    const month = isMonth(qMonth) ? qMonth : today.slice(0, 7), r = monthRange(month);
    const [member] = await db.select({ id: employees.id, name: employees.name, email: employees.email, phone: employees.phone, role: employees.role, positionId: employees.positionId,
      position: positions.name, active: employees.active, createdAt: employees.createdAt, avatar: employees.avatarKey })
      .from(employees).leftJoin(positions, eq(positions.id, employees.positionId))
      .where(and(eq(employees.id, id), isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier']))).limit(1);
    if (!member) throw new AppError(404, 'Không tìm thấy nhân viên.');

    const { orders, contracts } = await ordersOf(db, id);
    const ids = orders.map(o => o.id);
    const [schedules, payments, quoteRows, monthQuotes, custRows, newCustomers, taskRows] = await Promise.all([
      ids.length ? db.select({ orderId: paymentSchedules.orderId, amount: paymentSchedules.amount, dueDate: paymentSchedules.dueDate, kind: paymentSchedules.kind }).from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)) : [],
      ids.length ? db.select({ id: customerPayments.id, orderId: customerPayments.orderId, amount: customerPayments.amount, paidAt: customerPayments.paidAt, method: customerPayments.method,
        reference: customerPayments.reference, note: customerPayments.note }).from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))).orderBy(desc(customerPayments.paidAt)) : [],
      db.select({ id: quotations.id, quoteNo: quotations.quoteNo, quoteType: quotations.quoteType, customer: quotations.customer, quoteDate: quoteDay, approvalStatus: quotations.approvalStatus, data: quotations.data, updatedAt: quotations.updatedAt })
        .from(quotations).where(sql`${quoteOwner} = ${id}`).orderBy(desc(quotations.updatedAt)).limit(STAFF_HUB_LIMITS.quotes),
      db.select({ id: quotations.id, data: quotations.data }).from(quotations).where(and(sql`${quoteOwner} = ${id}`, sql`${quoteDay} >= ${r.from}`, sql`${quoteDay} < ${r.next}`)),
      db.select({ id: customers.id, name: customers.name, phone: customers.phone, approvalStatus: customers.approvalStatus, role: customerStaff.role })
        .from(customerStaff).innerJoin(customers, eq(customers.id, customerStaff.customerId)).where(eq(customerStaff.memberId, id)).orderBy(asc(customers.name)),
      db.select({ n: sql<number>`count(*)` }).from(customers).where(and(eq(customers.createdBy, id), gte(customers.createdAt, r.from), lt(customers.createdAt, r.next))),
      db.select({ status: tasks.status, dueDate: tasks.dueDate, completedAt: tasks.completedAt }).from(tasks)
        .where(and(eq(tasks.assigneeId, id), or(inArray(tasks.status, ['todo', 'in_progress']), and(eq(tasks.status, 'done'), gte(tasks.completedAt, r.from), lt(tasks.completedAt, r.next))))),
    ]);

    // ----- Đơn + công nợ (đã trừ hàng khách trả, như trang Công nợ)
    const net = await netReceivables(db, ids, today);
    const orderList = orders.map(o => ({
      id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, status: o.status, total: o.total, customerId: o.customerId, customerName: o.customerName, quoteNo: o.quoteNo, counted: o.counted,
      contract: o.contract ? { id: o.contract.id, contractNo: o.contract.contractNo, status: o.contract.status } : null,
      receivable: o.counted ? net.get(o.id)! : null,
    }));
    const debtors = orderList.filter(o => o.receivable && o.receivable.balance > 0);
    const orderNo = new Map(orders.map(o => [o.id, o.orderNo])), orderCustomer = new Map(orders.map(o => [o.id, o.customerName]));
    // Bản ghi có HĐKT là HĐKT (luồng riêng): kèm số HĐKT để hiện thay số đơn.
    const contractNo = new Map(contracts.map(k => [k.orderId, k.contractNo]));

    // ----- Khách hàng: khách được phân công + khách có đơn do nhân viên phụ trách.
    const byCustomer = new Map<string, { id: string; name: string; phone: string; role: string; approvalStatus: string; orders: number; revenue: number; balance: number; lastOrderDate: string | null }>();
    for (const k of custRows) byCustomer.set(k.id, { id: k.id, name: k.name, phone: k.phone, role: k.role, approvalStatus: k.approvalStatus, orders: 0, revenue: 0, balance: 0, lastOrderDate: null });
    for (const o of orderList) {
      if (!o.customerId || !o.counted) continue;
      let k = byCustomer.get(o.customerId);
      if (!k) byCustomer.set(o.customerId, k = { id: o.customerId, name: o.customerName, phone: '', role: 'order', approvalStatus: 'approved', orders: 0, revenue: 0, balance: 0, lastOrderDate: null });
      k.orders++; k.revenue += o.total; k.balance += Math.max(0, o.receivable?.balance ?? 0);
      if (!k.lastOrderDate || o.orderDate > k.lastOrderDate) k.lastOrderDate = o.orderDate;
    }

    // ----- KPI tháng
    const sales = revenueIn(orderList, month), wonQuotes = new Set(orders.filter(o => o.status !== 'cancelled' && o.quoteId).map(o => o.quoteId));
    const collected = payments.filter(p => monthOf(p.paidAt) === month).reduce((s, p) => s + p.amount, 0);
    const payroll = canViewPayroll ? await payrollOf(db, id, month, memberRevenues) : null;
    const target = payroll ? payroll.profile.revenueTarget || (payroll.profile.kpiEnabled ? payroll.params.kpiRevenue : 0) : 0;
    const kpi = {
      revenue: sales.revenue, orders: sales.orders, avgOrder: sales.orders ? Math.round(sales.revenue / sales.orders) : 0,
      revenueTarget: target, targetPercent: targetPercent(sales.revenue, target),
      quotes: monthQuotes.length, quoteValue: monthQuotes.reduce((s, q) => s + quoteTotal(q.data), 0),
      quotesWon: monthQuotes.filter(q => wonQuotes.has(q.id)).length, conversion: percent(monthQuotes.filter(q => wonQuotes.has(q.id)).length, monthQuotes.length),
      collected, contractsSigned: contracts.filter(k => (k.status === 'signed' || k.status === 'completed') && monthOf(k.signedDate) === month).length,
      newCustomers: Number(newCustomers[0]?.n ?? 0), customers: byCustomer.size,
      debt: { balance: debtors.reduce((s, o) => s + o.receivable!.balance, 0), overdue: debtors.reduce((s, o) => s + o.receivable!.overdue, 0), orders: debtors.length },
      tasks: { done: taskRows.filter(t => t.status === 'done').length, open: taskRows.filter(t => t.status !== 'done').length,
        overdue: taskRows.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).length },
      workedDays: payroll ? payroll.payslip?.workDays ?? payroll.attendanceSummary.worked : null, standardDays: payroll?.attendanceSummary.standardDays ?? null,
    };
    const months = Array.from({ length: STAFF_HUB_LIMITS.trendMonths }, (_, i) => shiftMonth(month, i - STAFF_HUB_LIMITS.trendMonths + 1));

    return json({
      member, month, today,
      access: { isSelf: me.id === id, canManage: me.role === 'manager', canViewPayroll },
      kpi, trend: trend(orderList, payments, months),
      customers: [...byCustomer.values()].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '') || a.name.localeCompare(b.name, 'vi')),
      quotes: quoteRows.map(({ data, ...q }) => { const orderId = orders.find(o => o.quoteId === q.id && o.status !== 'cancelled')?.id ?? null;
        return { ...q, total: quoteTotal(data), orderId, contractNo: orderId ? contractNo.get(orderId) ?? null : null }; }),
      orders: orderList,
      contracts: contracts.map(k => ({ ...k, orderNo: orderNo.get(k.orderId) ?? '', customerName: orderCustomer.get(k.orderId) ?? '' })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      payments: payments.slice(0, STAFF_HUB_LIMITS.payments).map(p => ({ ...p, orderNo: orderNo.get(p.orderId) ?? '', contractNo: contractNo.get(p.orderId) ?? null, customerName: orderCustomer.get(p.orderId) ?? '' })),
      debts: debtors.map(o => ({ id: o.id, orderNo: o.orderNo, contractNo: contractNo.get(o.id) ?? null, orderDate: o.orderDate, customerName: o.customerName, ...o.receivable! })),
      payroll,
    });
  }, 'business');
}

