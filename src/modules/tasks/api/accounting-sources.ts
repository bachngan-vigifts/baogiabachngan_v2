import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { salesOrders, salesContracts, paymentSchedules, customerPayments } from '../../sales/schema.ts';
import { webStoreOrders } from '../../sales/pos-schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { debtCounts, receivable } from '../../sales/domain/sales.ts';
import { incomingShipments, incomingShipmentLines, supplierPaymentSchedules, supplierPayments } from '../../suppliers/schema.ts';
import { supplierDebt, canSeePrices } from '../../suppliers/domain/purchasing.ts';
import { computeOrderTotals } from '../../suppliers/domain/order-totals.ts';
import { asActor, purchaseScope } from '../../suppliers/api/purchase-store.ts';
import { tasks } from '../schema.ts';
import { accountingKind } from '../domain/accounting.ts';
import { addDaysIso } from '../domain/task-config.ts';
import type { AutoTask } from './auto-tasks.ts';
type Db = StaffEnv['db'];
type Task = typeof tasks.$inferSelect;
type Member = SessionState['member'];
export interface AccountingSource {
  kind: 'invoice' | 'web' | 'purchase' | 'debt'; amount: number | null; currency: string; docNo: string; link: string; linkLabel: string;
  total?: number; paid?: number; paymentCount?: number; periodCount?: number; periodAmount?: number; dueDate?: string | null; balance?: number; overdue?: number;
  taxCode?: string; invoiceMode?: string; ghnCode?: string; outstanding: boolean | null; available: boolean;
}
async function purchaseData(db: Db, ids?: string[]) {
  const orders = await db.select().from(incomingShipments).where(and(eq(incomingShipments.source, 'supplier-order'), ids ? inArray(incomingShipments.id, ids) : and(eq(incomingShipments.approvalStatus, 'approved'), isNull(incomingShipments.cancelledAt))));
  const keys = orders.map(o => o.id);
  const [lines, schedules, payments] = keys.length ? await Promise.all([
    db.select().from(incomingShipmentLines).where(inArray(incomingShipmentLines.shipmentId, keys)),
    db.select().from(supplierPaymentSchedules).where(inArray(supplierPaymentSchedules.shipmentId, keys)),
    db.select().from(supplierPayments).where(inArray(supplierPayments.shipmentId, keys)),
  ]) : [[], [], []];
  return orders.map(o => ({ order: o, total: computeOrderTotals({ rows: lines.filter(l => l.shipmentId === o.id), depositRate: o.depositRate, paidAmount: 0 }).total,
    schedules: schedules.filter(s => s.shipmentId === o.id), payments: payments.filter(p => p.shipmentId === o.id) }));
}
/** Use the existing supplierDebt allocation, including its rounding and void handling. No money formula changes. */
function periodAmount(p: Awaited<ReturnType<typeof purchaseData>>[number], date: string) {
  return Math.max(0, supplierDebt(p.total, p.schedules, p.payments, addDaysIso(date, 1)).overdue - supplierDebt(p.total, p.schedules, p.payments, date).overdue);
}
// A task groups schedules sharing a due date; KPI counts the actual unpaid schedule rows.
function periodCount(p: Awaited<ReturnType<typeof purchaseData>>[number], date: string) {
  const ordered = [...p.schedules].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return ordered.reduce((count, s, i) => count + (s.dueDate === date && supplierDebt(p.total, ordered.slice(0, i + 1), p.payments, addDaysIso(date, 1)).overdue > supplierDebt(p.total, ordered.slice(0, i), p.payments, addDaysIso(date, 1)).overdue ? 1 : 0), 0);
}
export async function supplierPaymentTasks(db: Db, today: string): Promise<AutoTask[]> {
  const out: AutoTask[] = [];
  for (const p of await purchaseData(db)) {
    for (const date of [...new Set(p.schedules.map(s => s.dueDate).filter((d): d is string => !!d && d <= addDaysIso(today, 3)))]) {
      const amount = periodAmount(p, date); if (amount <= 0) continue;
      out.push({ autoKey: `po-pay:${p.order.id}:${date}`, source: 'purchase', sourceId: p.order.id,
        title: `Trả NCC ${p.order.ticketNumber} – ${p.order.supplierName}`, description: `Kỳ ${new Intl.NumberFormat('vi-VN').format(amount)} đ hạn ${date}. Ghi khoản trả kèm chứng từ trên đơn mua.`,
        link: `#/purchases/${p.order.id}`, assigneeId: null, assigneePosition: 'accounting', priority: date < today ? 'urgent' : 'high', dueDate: date });
    }
  }
  return out;
}
/** Only task-visible ids enter this loader. Financial source/page scopes are checked again before returning amounts/links. */
export async function accountingSources(db: Db, member: Member, rows: Task[], today: string, canReadPrivate: (t: Task) => boolean) {
  const out = new Map<string, AccountingSource>();
  const ids = (kinds: string[]) => [...new Set(rows.filter(t => kinds.includes(accountingKind(t.autoKey) || '')).map(t => t.sourceId).filter((x): x is string => !!x))];
  const saleIds = ids(['invoice', 'debt']), buyIds = ids(['purchase']), webIds = ids(['web']);
  const canOrders = ['page.orders', 'page.contracts', 'page.receivables'].some(p => can(member, p));
  const [orders, buys, webs] = await Promise.all([
    saleIds.length && canOrders ? db.select({ o: salesOrders, k: salesContracts }).from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id)).where(and(inArray(salesOrders.id, saleIds), orderScopeFor(member))) : [],
    buyIds.length && can(member, 'page.purchases') && canSeePrices(asActor(member)) ? purchaseData(db, buyIds) : [],
    webIds.length ? db.select().from(webStoreOrders).where(inArray(webStoreOrders.id, webIds)) : [],
  ]);
  const visibleBuys = buys.length ? new Set((await db.select({ id: incomingShipments.id }).from(incomingShipments).where(and(inArray(incomingShipments.id, buys.map(p => p.order.id)), purchaseScope(member)))).map(o => o.id)) : new Set<string>();
  const [schedules, payments] = orders.length ? await Promise.all([
    db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, orders.map(o => o.o.id))),
    db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, orders.map(o => o.o.id)), isNull(customerPayments.voidedAt))),
  ]) : [[], []];
  for (const t of rows) {
    const kind = accountingKind(t.autoKey); if (!kind) continue;
    const source: AccountingSource = { kind, amount: null, currency: 'VND', docNo: '', link: '', linkLabel: '', outstanding: null, available: false };
    const sale = orders.find(p => p.o.id === t.sourceId), buy = buys.find(p => p.order.id === t.sourceId), web = webs.find(p => p.id === t.sourceId);
    if (sale && (kind === 'invoice' || kind === 'debt')) {
      const { o, k } = sale, ref = docRef(o.id, o.orderNo, k?.contractNo);
      const r = receivable(schedules.filter(s => s.orderId === o.id), payments.filter(p => p.orderId === o.id), today);
      const valid = debtCounts(o.status, k?.status);
      Object.assign(source, { available: true, amount: kind === 'debt' ? r.overdue : o.total, total: o.total, paid: r.paid, balance: r.balance, overdue: r.overdue,
        docNo: ref.no, link: ref.link, linkLabel: k ? 'Mở HĐKT' : 'Mở đơn', taxCode: o.taxCode, invoiceMode: o.invoiceMode,
        outstanding: kind === 'debt' ? valid && r.overdue > 0 : o.invoiceStatus === 'requested' && !['draft', 'cancelled'].includes(o.status) });
    } else if (kind === 'purchase' && buy && visibleBuys.has(buy.order.id)) {
      const date = t.autoKey!.slice(`po-pay:${buy.order.id}:`.length), debt = supplierDebt(buy.total, buy.schedules, buy.payments, today);
      const amount = /^\d{4}-\d{2}-\d{2}$/.test(date) ? periodAmount(buy, date) : 0;
      Object.assign(source, { available: true, amount, total: debt.total, paid: debt.paid, paymentCount: buy.payments.filter(p => !p.voidedAt).length,
        balance: debt.balance, periodCount: periodCount(buy, date), periodAmount: amount, dueDate: date, overdue: debt.overdue, docNo: buy.order.ticketNumber,
        link: can(member, 'page.purchases') ? `#/purchases/${buy.order.id}` : '', linkLabel: 'Mở đơn mua NCC',
        outstanding: buy.order.approvalStatus === 'approved' && !buy.order.cancelledAt && amount > 0 && date <= addDaysIso(today, 3) });
    } else if (kind === 'web' && web && canReadPrivate(t)) {
      Object.assign(source, { available: true, amount: web.total, total: web.total, currency: web.currency, docNo: web.orderNo, ghnCode: web.ghnOrderCode, invoiceMode: 'unknown', outstanding: null });
    }
    out.set(t.id, source);
  }
  return out;
}
