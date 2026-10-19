import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { cashAudit, type CashDb } from './cash-store.ts';
import {
  posReturns,
  posRefunds,
  posExchangeAllocations,
} from '../return-schema.ts';
import { salesOrders, customerPayments } from '../schema.ts';
import { posPaymentRequests, posShifts } from '../pos-schema.ts';
import { returnBalance } from '../domain/pos-return-money.ts';
export async function returnAccount(
  db: CashDb,
  orderId: string,
  cutoff = new Date().toISOString(),
) {
  const [[o], rs, ps] = await Promise.all([
    db.select().from(salesOrders).where(eq(salesOrders.id, orderId)),
    db.select().from(posReturns).where(eq(posReturns.orderId, orderId)),
    db
      .select()
      .from(customerPayments)
      .where(
        and(
          eq(customerPayments.orderId, orderId),
          sql`${customerPayments.createdAt}<=${cutoff} and (${customerPayments.voidedAt} is null or ${customerPayments.voidedAt}>${cutoff})`,
        ),
      ),
  ]);
  if (!o) throw new AppError(404, 'Không tìm thấy bill gốc.');
  const ids = rs.map((r) => r.id);
  const [refunds, allocations] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(posRefunds)
          .where(
            and(
              inArray(posRefunds.returnId, ids),
              sql`${posRefunds.confirmedAt}<=${cutoff}`,
            ),
          ),
        db
          .select()
          .from(posExchangeAllocations)
          .where(inArray(posExchangeAllocations.returnId, ids)),
      ])
    : [[], []];
  const credit = rs
      .filter((r) => r.creditEffectiveAt && r.creditEffectiveAt <= cutoff)
      .reduce((n, r) => n + r.total, 0),
    refunded = refunds.reduce((n, r) => n + r.amount, 0),
    exchanged = allocations
      .filter((a) => a.status === 'applied' && a.appliedAt! <= cutoff)
      .reduce((n, a) => n + a.amount, 0),
    paid = ps.reduce((n, p) => n + p.amount, 0);
  return {
    ...returnBalance(o.total, paid, credit, refunded, exchanged),
    credit,
    refunded,
    exchanged,
    paid,
    returns: rs,
    refunds,
    allocations,
  };
}
export async function allocationProtected(db: CashDb, id: string) {
  const [qr] = await db
    .select({ id: posPaymentRequests.id })
    .from(posPaymentRequests)
    .where(
      and(
        sql`${posPaymentRequests.cart}::jsonb->>'exchangeAllocationId'=${id}`,
        sql`(${posPaymentRequests.confirmedAt} is not null or ${posPaymentRequests.expiresAt}>${new Date().toISOString()})`,
      ),
    )
    .limit(1);
  return !!qr;
}
export async function activeReservations(
  db: CashDb,
  rows: (typeof posExchangeAllocations.$inferSelect)[],
  excluding = '',
  releaseExpired = false,
) {
  let amount = 0;
  for (const a of rows)
    if (a.id !== excluding && a.status === 'reserved') {
      if (
        a.expiresAt > new Date().toISOString() ||
        (await allocationProtected(db, a.id))
      )
        amount += a.amount;
      else if (releaseExpired) {
        // Call with releaseExpired only inside cashLock's transaction, shared with SePay.
        const changed = await db
          .update(posExchangeAllocations)
          .set({ status: 'cancelled' })
          .where(
            and(
              eq(posExchangeAllocations.id, a.id),
              eq(posExchangeAllocations.status, 'reserved'),
            ),
          )
          .returning({ id: posExchangeAllocations.id });
        if (changed.length)
          await cashAudit(
            db,
            a.createdBy,
            'expire-exchange',
            'pos-returns',
            a.returnId,
            { allocationId: a.id, system: true },
          );
      }
    }
  return amount;
}
export async function exchangeForCart(
  db: CashDb,
  id: string,
  shiftId: string,
  registerId: string,
  total: number,
  customerId: string,
) {
  if (!id) return { amount: 0, allocation: null };
  const [a] = await db
    .select()
    .from(posExchangeAllocations)
    .where(eq(posExchangeAllocations.id, id));
  if (
    !a ||
    a.status !== 'reserved' ||
    (a.expiresAt <= new Date().toISOString() &&
      !(await allocationProtected(db, a.id)))
  )
    throw new AppError(409, 'Khoản đổi hàng đã dùng hoặc hết hạn.');
  const [r] = await db
    .select()
    .from(posReturns)
    .where(eq(posReturns.id, a.returnId));
  const [s] = await db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, shiftId));
  const [o] = await db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, r!.orderId));
  if (
    !r?.creditEffectiveAt ||
    !s ||
    s.memberId !== a.createdBy ||
    r.registerId !== registerId ||
    s.registerId !== registerId ||
    (o!.customerId || '') !== customerId
  )
    throw new AppError(
      403,
      'Khoản đổi hàng phải thuộc nhân viên, khách và quầy hiện tại.',
    );
  const account = await returnAccount(db, r.orderId);
  const reserved = await activeReservations(db, account.allocations, a.id);
  if (a.amount > total || a.amount > account.available - reserved)
    throw new AppError(
      409,
      'Tiền đổi hàng vượt bill mới hoặc số còn được hoàn. Bỏ áp dụng và chọn lại.',
    );
  return { amount: a.amount, allocation: a };
}
export async function assertNoReturnActivity(db: CashDb, orderId: string) {
  const [r] = await db
    .select({ id: posReturns.id })
    .from(posReturns)
    .where(
      and(
        eq(posReturns.orderId, orderId),
        sql`${posReturns.status} not in ('rejected','cancelled')`,
      ),
    )
    .limit(1);
  const [a] = await db
    .select({ id: posExchangeAllocations.id })
    .from(posExchangeAllocations)
    .where(
      and(
        eq(posExchangeAllocations.replacementOrderId, orderId),
        eq(posExchangeAllocations.status, 'applied'),
      ),
    )
    .limit(1);
  if (r || a)
    throw new AppError(
      409,
      'Bill đang có chứng từ trả/đổi hàng. Không huỷ/sửa phiếu thu hoặc giá trị bill gốc; xử lý chứng từ liên kết trước.',
    );
}
export async function returnAdjustments(db: CashDb, orderIds: string[]) {
  const out = new Map<string, { credit: number; settled: number }>();
  if (!orderIds.length) return out;
  const rows = await db
    .select()
    .from(posReturns)
    .where(inArray(posReturns.orderId, orderIds));
  for (const r of rows)
    if (r.creditEffectiveAt) {
      const x = out.get(r.orderId) || { credit: 0, settled: 0 };
      x.credit += r.total;
      out.set(r.orderId, x);
    }
  const ids = rows.map((r) => r.id);
  if (!ids.length) return out;
  const [refunds, allocs] = await Promise.all([
    db.select().from(posRefunds).where(inArray(posRefunds.returnId, ids)),
    db
      .select()
      .from(posExchangeAllocations)
      .where(
        and(
          inArray(posExchangeAllocations.returnId, ids),
          eq(posExchangeAllocations.status, 'applied'),
        ),
      ),
  ]);
  for (const item of [...refunds, ...allocs]) {
    const id = rows.find((r) => r.id === item.returnId)!.orderId;
    const x = out.get(id) || { credit: 0, settled: 0 };
    x.settled += item.amount;
    out.set(id, x);
  }
  return out;
}
/** Keep original schedules/receipts immutable; project their remaining financial effect for receivables. */
export function netReturnInputs<
  S extends { amount: number },
  P extends { amount: number },
>(
  schedules: S[],
  payments: P[],
  adjustment?: { credit: number; settled: number },
) {
  const reduce = <T extends { amount: number }>(rows: T[], amount: number) => {
    const out = rows.map((x) => ({ ...x }));
    for (let i = out.length - 1; i >= 0 && amount > 0; i--) {
      const take = Math.min(out[i]!.amount, amount);
      out[i]!.amount -= take;
      amount -= take;
    }
    return out;
  };
  return {
    schedules: reduce(schedules, adjustment?.credit || 0),
    payments: reduce(payments, adjustment?.settled || 0),
  };
}
