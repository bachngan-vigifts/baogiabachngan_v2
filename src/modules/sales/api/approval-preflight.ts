import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { salesOrders, salesContracts, paymentSchedules, customerPayments } from '../schema.ts';
import { debtCounts, receivable, vietnamDate } from '../domain/sales.ts';
import { returnAdjustments, netReturnInputs } from './pos-return-credit.ts';
import { printingInfo, type QuoteDoc } from '../../quotes/domain/quote-math.ts';
import { AppError } from '../../../core/errors.ts';
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];

/** Existing receivable rules, including returns/refunds; no matching by customer name or phone. */
export async function approvalDebt(db: Db, customerId: string | null, taxCode = '', excludeId = '') {
  if (!customerId && !taxCode.trim()) return { total: 0, orders: [] };
  const rows = await db.select().from(salesOrders).where(and(
    or(customerId ? eq(salesOrders.customerId, customerId) : undefined, taxCode.trim() ? eq(salesOrders.taxCode, taxCode.trim()) : undefined),
    ne(salesOrders.id, excludeId), ne(salesOrders.status, 'cancelled'),
    or(ne(salesOrders.status, 'draft'), sql`exists(select 1 from ${salesContracts} where ${salesContracts.orderId}=${salesOrders.id} and ${salesContracts.status} in ('signed','completed'))`),
  ));
  if (!rows.length) return { total: 0, orders: [] };
  const ids = rows.map(r => r.id);
  const [contracts, schedules, payments, adjustments] = await Promise.all([
    db.select().from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
    db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))),
    returnAdjustments(db, ids),
  ]);
  const orders = rows.flatMap(o => {
    const contract = contracts.find(k => k.orderId === o.id);
    if (!debtCounts(o.status, contract?.status)) return [];
    const net = netReturnInputs(schedules.filter(s => s.orderId === o.id), payments.filter(p => p.orderId === o.id), adjustments.get(o.id));
    const debt = receivable(net.schedules, net.payments, vietnamDate().iso);
    return debt.overdue > 0 ? [{ id: o.id, no: contract?.contractNo || o.orderNo, overdue: debt.overdue, balance: debt.balance }] : [];
  });
  return { total: orders.reduce((sum, o) => sum + o.overdue, 0), orders };
}
export function assertApprovalDebt(debt: Awaited<ReturnType<typeof approvalDebt>>) {
  if (debt.total > 0) throw new AppError(409, 'Khách hàng có công nợ quá hạn. Vui lòng thanh toán để tạo hoặc duyệt đơn hàng mới.', 'CUSTOMER_DEBT_OVERDUE');
}

/** Zero is a valid explicitly entered cost; missing costs must not be inferred from sales print fees. */
export function approvalCosts(doc: QuoteDoc) {
  const printed = printingInfo(doc).enabled ? doc.rows.filter(r => Number(r.printFee) > 0 && Number(r.qty) > 0) : [];
  const hasTotal = typeof doc.printing?.totalCost === 'number' && Number.isFinite(doc.printing.totalCost);
  const usesLineCosts = doc.rows.some(r => typeof r.printing?.unitPrice === 'number' && Number.isFinite(r.printing.unitPrice));
  const missingPrinting = (usesLineCosts || !hasTotal) && printed.some(r => typeof r.printing?.unitPrice !== 'number' || !Number.isFinite(r.printing.unitPrice));
  const missingCommission = doc.rows.some(r => Number(r.qty) > 0 && !r.commission?.excluded && !Number.isFinite(r.commission?.value));
  const shipping = doc.shipping as { payer?: string; rate?: number; extra?: number } | undefined;
  const missingShipping = !shipping || (shipping.payer !== 'receiver' && !(Number(shipping.rate) > 0 || Number(shipping.extra) > 0));
  return { missingPrinting, missingCommission, missingShipping };
}
