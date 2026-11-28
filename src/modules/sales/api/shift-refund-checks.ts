import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { posRefunds, posReturns } from '../return-schema.ts';
import { cashEntries } from '../cash-schema.ts';
import { customerPayments } from '../schema.ts';
import type { posShifts } from '../pos-schema.ts';
import { returnAccount } from './pos-return-credit.ts';
import type { CashDb } from './cash-store.ts';

export type ShiftRefundCheck = { level: 'block' | 'warn'; code: string; message: string; refs: string[] };
const REFUND_WORDS = /(hoàn|hoan|trả lại khách|tra lai khach|refund)/i;

/**
 * Refund integrity of one shift, for the close-shift report. Blocking checks are states that make the drawer
 * figure wrong (cash refund off this drawer/shift, transfer refund that moved cash, drawer refund entry with no
 * refund, refunds above receipts). Warnings need a human look (manual expense that mirrors a cash refund).
 */
export async function shiftRefundChecks(db: CashDb, s: typeof posShifts.$inferSelect, cutoff: string) {
  const active = sql`${posRefunds.confirmedAt}<=${cutoff} and (${posRefunds.voidedAt} is null or ${posRefunds.voidedAt}>${cutoff})`;
  const refunds = await db.select({ r: posRefunds, e: cashEntries }).from(posRefunds)
    .leftJoin(cashEntries, eq(cashEntries.id, posRefunds.cashEntryId))
    .where(and(eq(posRefunds.shiftId, s.id), active));
  const checks: ShiftRefundCheck[] = [];
  const add = (level: ShiftRefundCheck['level'], code: string, message: string, refs: string[]) => { if (refs.length) checks.push({ level, code, message, refs }); };
  add('block', 'cash_refund_off_drawer', 'Phiếu hoàn tiền mặt không có phiếu chi két hợp lệ ở đúng ca/két này. Manager sửa phiếu hoàn trước khi kết ca.',
    refunds.filter(({ r, e }) => r.method === 'cash' && (!e || e.status !== 'posted' || e.shiftId !== s.id || e.drawerId !== s.cashDrawerId || e.amount !== r.amount || e.kind !== 'customer_refund')).map(({ r }) => r.refundNo));
  add('block', 'transfer_refund_moved_cash', 'Phiếu hoàn chuyển khoản lại có phiếu chi két tiền mặt.', refunds.filter(({ r }) => r.method === 'transfer' && r.cashEntryId).map(({ r }) => r.refundNo));
  const orphans = await db.select({ entryNo: cashEntries.entryNo }).from(cashEntries)
    .where(and(eq(cashEntries.shiftId, s.id), eq(cashEntries.kind, 'customer_refund'), eq(cashEntries.status, 'posted'), sql`${cashEntries.createdAt}<=${cutoff}`,
      sql`not exists(select 1 from ${posRefunds} where ${posRefunds.cashEntryId}=${cashEntries.id} and (${posRefunds.voidedAt} is null or ${posRefunds.voidedAt}>${cutoff}))`));
  add('block', 'refund_entry_without_refund', 'Phiếu chi hoàn tiền trong két không còn phiếu hoàn tương ứng.', orphans.map((x) => x.entryNo));
  // Refunds above receipts on any order this shift refunded.
  const orderIds = refunds.length ? [...new Set((await db.select({ orderId: posReturns.orderId }).from(posReturns).where(inArray(posReturns.id, refunds.map(({ r }) => r.returnId)))).map((x) => x.orderId))] : [];
  const over: string[] = [];
  for (const id of orderIds) {
    const a = await returnAccount(db, id, cutoff);
    if (a.refunded + a.exchanged > a.paid) over.push(a.refunds[0]?.refundNo ?? id);
  }
  add('block', 'refunded_over_paid', 'Tổng đã hoàn/đổi vượt tổng đã thu của đơn.', over);
  // Manual drawer expenses that mirror a cash refund of this drawer in the last 3 days.
  const since = new Date(Date.parse(cutoff) - 3 * 86400000).toISOString();
  const cashRefunds = await db.select({ refundNo: posRefunds.refundNo, amount: posRefunds.amount }).from(posRefunds)
    .where(and(eq(posRefunds.drawerId, s.cashDrawerId), eq(posRefunds.method, 'cash'), gte(posRefunds.confirmedAt, since), active));
  const manual = cashRefunds.length ? await db.select({ entryNo: cashEntries.entryNo, amount: cashEntries.amount, reason: cashEntries.reason }).from(cashEntries)
    .where(and(eq(cashEntries.shiftId, s.id), eq(cashEntries.direction, 'out'), eq(cashEntries.status, 'posted'), inArray(cashEntries.kind, ['petty_expense', 'advance']), sql`${cashEntries.createdAt}<=${cutoff}`)) : [];
  add('warn', 'suspected_duplicate_refund', 'Phiếu chi tay có nội dung hoàn tiền trùng số tiền với phiếu hoàn tiền mặt gần đây; kiểm tra có ghi hai lần không.',
    manual.filter((m) => REFUND_WORDS.test(m.reason) && cashRefunds.some((r) => r.amount === m.amount)).map((m) => m.entryNo));
  // Returns received in this shift that still owe the customer money.
  const received = await db.select({ id: posReturns.id, orderId: posReturns.orderId, returnNo: posReturns.returnNo }).from(posReturns)
    .where(and(or(eq(posReturns.receivedShiftId, s.id), eq(posReturns.createdShiftId, s.id)), eq(posReturns.status, 'processing'), sql`${posReturns.creditEffectiveAt}<=${cutoff}`));
  let pendingCount = 0, pendingAmount = 0;
  for (const orderId of [...new Set(received.map((r) => r.orderId))]) {
    const a = await returnAccount(db, orderId, cutoff);
    if (a.available > 0) { pendingCount++; pendingAmount += a.available; }
  }
  const exchangeApplied = Number((await db.select({ n: sql<number>`coalesce(sum(${customerPayments.amount}),0)` }).from(customerPayments)
    .where(and(eq(customerPayments.shiftId, s.id), eq(customerPayments.paymentSource, 'pos_exchange_credit'), sql`${customerPayments.createdAt}<=${cutoff}`, or(isNull(customerPayments.voidedAt), sql`${customerPayments.voidedAt}>${cutoff}`))))[0]?.n || 0);
  return { checks, pendingRefunds: { count: pendingCount, amount: pendingAmount }, exchangeApplied };
}
