import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { customerPayments, salesOrders } from '../../sales/schema.ts';
import { cashEntries } from '../../sales/cash-schema.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { contractNosOf } from '../../sales/api/routes.ts';
import { addDaysIso } from '../domain/task-config.ts';
type Db = StaffEnv['db'];
type Member = SessionState['member'];

/** Số ngày từ lúc yêu cầu xuất hoá đơn mà chưa xuất thì cảnh báo. */
export const STALE_INVOICE_DAYS = 7;
const LIMIT = 50;

/**
 * "Cần kiểm tra" trên trang Việc kế toán – CHỈ ĐỌC, không sinh việc, không sửa dữ liệu. Gợi ý để người kiểm, không phải kết luận:
 *  - thu trùng: cùng đơn, cùng số tiền, cùng ngày thu, có từ 2 phiếu thu còn hiệu lực (30 ngày gần nhất);
 *  - yêu cầu xuất hoá đơn quá 7 ngày chưa xuất (đơn chưa huỷ);
 *  - phiếu chi két từ ngưỡng duyệt trở lên mà chưa có ảnh hoá đơn (30 ngày gần nhất; chỉ người được xem tất cả phiếu két).
 */
export async function accountingChecks(db: Db, member: Member, today: string) {
  const since = addDaysIso(today, -30);
  const dupRows = await db.select({ orderId: customerPayments.orderId, amount: customerPayments.amount, paidAt: customerPayments.paidAt, n: sql<number>`count(*)::int` })
    .from(customerPayments).where(and(isNull(customerPayments.voidedAt), gte(customerPayments.paidAt, since)))
    .groupBy(customerPayments.orderId, customerPayments.amount, customerPayments.paidAt).having(sql`count(*) > 1`)
    .orderBy(desc(customerPayments.paidAt)).limit(LIMIT);
  const staleRows = await db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total, requestedAt: salesOrders.invoiceRequestedAt })
    .from(salesOrders).where(and(eq(salesOrders.invoiceStatus, 'requested'), ne(salesOrders.status, 'cancelled'), lt(salesOrders.invoiceRequestedAt, addDaysIso(today, -STALE_INVOICE_DAYS) + 'T00:00:00.000Z')))
    .orderBy(salesOrders.invoiceRequestedAt).limit(LIMIT);
  const orderIds = [...new Set([...dupRows.map(r => r.orderId), ...staleRows.map(r => r.id)])];
  const [orders, contracts] = orderIds.length ? await Promise.all([
    db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName }).from(salesOrders).where(inArray(salesOrders.id, orderIds)),
    contractNosOf(db, orderIds),
  ]) : [[], new Map<string, string>()];
  const ref = (id: string) => { const o = orders.find(x => x.id === id); return { ...docRef(id, o?.orderNo ?? '', contracts.get(id)), customerName: o?.customerName ?? '' }; };
  const days = (iso: string | null) => iso ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(iso.slice(0, 10) + 'T00:00:00Z')) / 864e5)) : 0;
  const cash = can(member, 'cash.view-all') ? await db.select({ id: cashEntries.id, entryNo: cashEntries.entryNo, amount: cashEntries.amount, reason: cashEntries.reason, createdAt: cashEntries.createdAt })
    .from(cashEntries).where(and(eq(cashEntries.direction, 'out'), ne(cashEntries.status, 'voided'), isNull(cashEntries.photoFileKey),
      sql`${cashEntries.amount} >= ${cashEntries.approvalThresholdSnapshot}`, gte(cashEntries.createdAt, since + 'T00:00:00.000Z')))
    .orderBy(desc(cashEntries.createdAt)).limit(LIMIT) : null;
  return {
    duplicatePayments: dupRows.map(r => { const d = ref(r.orderId); return { orderId: r.orderId, docNo: d.no, link: d.link, customerName: d.customerName, amount: r.amount, paidAt: r.paidAt, count: r.n }; }),
    staleInvoices: staleRows.map(r => { const d = ref(r.id); return { orderId: r.id, docNo: d.no, link: d.link, customerName: r.customerName, total: r.total, days: days(r.requestedAt) }; }),
    cashWithoutPhoto: cash?.map(e => ({ id: e.id, entryNo: e.entryNo, amount: e.amount, reason: e.reason, createdAt: e.createdAt })) ?? null,
    staleInvoiceDays: STALE_INVOICE_DAYS,
  };
}
