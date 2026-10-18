import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { sanitizeForAudit } from '../../../core/audit.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { cashDrawers, cashEntries, cashReconciliations } from '../cash-schema.ts';
import { posShifts } from '../pos-schema.ts';
import { customerPayments } from '../schema.ts';
import { cashCloseReason } from '../domain/cash.ts';
import { posMoney } from '../domain/pos-money.ts';
export type CashDb = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export type CashMember = SessionState['member'];
export const CASH_DRAWER = 'store';
export const cashNow = () => new Date().toISOString();
export const seesAllCash = (m: CashMember) => can(m, 'cash.view-all');
export function cashAccess(m: CashMember) {
  if (!can(m, 'page.cash') && !can(m, 'pos.sell')) throw new AppError(403, 'Chưa có quyền Sổ quỹ.');
}
export async function cashLock(db: CashDb) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('cash-drawer:store'))`);
}
export async function cashAudit(
  db: CashDb,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  data: unknown,
) {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorId,
    module: 'cash',
    action,
    entityType,
    entityId,
    data: JSON.stringify(sanitizeForAudit(data) ?? {}),
    createdAt: cashNow(),
  });
}
export async function drawerOf(db: CashDb) {
  const [d] = await db.select().from(cashDrawers).where(eq(cashDrawers.id, CASH_DRAWER));
  if (!d) throw new AppError(409, 'Chưa chạy migration cấu hình két.');
  return d;
}
export async function nextCashOpening(db: CashDb) {
  const d = await drawerOf(db);
  if (d.openingSetAt === null || d.openingAmount === null)
    throw new AppError(
      409,
      'Manager cần nhập số dư đầu kỳ và lý do tại Sổ quỹ trước khi mở ca.',
      'CASH_OPENING_REQUIRED',
    );
  const [current] = await db
    .select()
    .from(posShifts)
    .where(and(eq(posShifts.cashDrawerId, d.id), isNull(posShifts.closedAt)))
    .limit(1);
  if (current) throw new AppError(409, 'Két chung đang có ca mở. Kết và bàn giao ca trước.', 'CASH_SHIFT_OPEN');
  const [previous] = await db
    .select()
    .from(posShifts)
    .where(and(eq(posShifts.cashDrawerId, d.id), sql`${posShifts.closedAt} is not null`))
    .orderBy(desc(posShifts.closedAt), desc(posShifts.id))
    .limit(1);
  return {
    openingCash: previous ? posMoney(previous.countedCash, 'Tiền bàn giao ca trước') : d.openingAmount,
    previousShiftId: previous?.id ?? null,
    cashDrawerId: d.id,
  };
}
export async function cashShiftTotals(db: CashDb, shiftId: string) {
  const [manual, payments, pending] = await Promise.all([
    db
      .select({
        direction: cashEntries.direction,
        kind: cashEntries.kind,
        amount: sql<number>`coalesce(sum(${cashEntries.amount}),0)`.mapWith(Number),
      })
      .from(cashEntries)
      .where(and(eq(cashEntries.shiftId, shiftId), eq(cashEntries.status, 'posted')))
      .groupBy(cashEntries.direction, cashEntries.kind),
    db
      .select({
        source: customerPayments.paymentSource,
        amount: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number),
      })
      .from(customerPayments)
      .where(
        and(
          eq(customerPayments.shiftId, shiftId),
          eq(customerPayments.method, 'cash'),
          isNull(customerPayments.voidedAt),
        ),
      )
      .groupBy(customerPayments.paymentSource),
    db
      .select({
        id: cashEntries.id,
        entryNo: cashEntries.entryNo,
        amount: cashEntries.amount,
        reason: cashEntries.reason,
      })
      .from(cashEntries)
      .where(and(eq(cashEntries.shiftId, shiftId), eq(cashEntries.status, 'pending'))),
  ]);
  return {
    // A book correction has no physical cash flow; actual opening already inherited the prior count.
    manual: manual.filter((p) => p.kind !== 'adjustment'),
    bookAdjustments: manual.filter((p) => p.kind === 'adjustment'),
    pending,
    cashSales: payments.filter((p) => p.source !== 'cod').reduce((n, p) => n + p.amount, 0),
    cashCod: payments.filter((p) => p.source === 'cod').reduce((n, p) => n + p.amount, 0),
    manualNet: manual
      .filter((p) => p.kind !== 'adjustment')
      .reduce((n, r) => n + (r.direction === 'in' ? r.amount : -r.amount), 0),
  };
}
export async function drawerBalance(db: CashDb) {
  const [d, manual, payments] = await Promise.all([
    drawerOf(db),
    db
      .select({
        total:
          sql<number>`coalesce(sum(case when ${cashEntries.direction}='in' then ${cashEntries.amount} else -${cashEntries.amount} end),0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries)
      .where(and(eq(cashEntries.drawerId, CASH_DRAWER), eq(cashEntries.status, 'posted'))),
    db
      .select({ total: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number) })
      .from(customerPayments)
      .innerJoin(posShifts, eq(posShifts.id, customerPayments.shiftId))
      .where(
        and(
          eq(posShifts.cashDrawerId, CASH_DRAWER),
          eq(customerPayments.method, 'cash'),
          isNull(customerPayments.voidedAt),
        ),
      ),
  ]);
  return (d.openingAmount ?? 0) + (manual[0]?.total ?? 0) + (payments[0]?.total ?? 0);
}
export async function reconciliationFor(
  db: CashDb,
  s: typeof posShifts.$inferSelect,
  actorId: string,
  reasonCode: string,
  reasonNote: string,
) {
  const totals = await cashShiftTotals(db, s.id),
    expectedCash = s.openingCash + totals.cashSales + totals.cashCod + totals.manualNet,
    countedCash = s.countedCash ?? 0,
    difference = countedCash - expectedCash;
  const [existing] = await db.select().from(cashReconciliations).where(eq(cashReconciliations.shiftId, s.id));
  const now = cashNow();
  if (existing) {
    await db
      .update(cashReconciliations)
      .set({
        status: 'pending',
        expectedCash,
        countedCash,
        difference,
        reasonNote: existing.reasonNote + '\n' + reasonNote,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
        closeReason: '',
      })
      .where(eq(cashReconciliations.id, existing.id));
    await cashAudit(db, actorId, 'reopen', 'cash-reconciliations', existing.id, {
      shiftId: s.id,
      reasonCode,
      reasonNote,
      difference,
    });
    return existing.id;
  }
  const [n] = await db.select({ n: count() }).from(cashReconciliations),
    id = crypto.randomUUID(),
    reconciliationNo = 'TS-' + String((n?.n ?? 0) + 1).padStart(4, '0');
  await db.insert(cashReconciliations).values({
    id,
    reconciliationNo,
    drawerId: s.cashDrawerId,
    shiftId: s.id,
    closedBy: s.memberId,
    expectedCash,
    countedCash,
    difference,
    reasonCode,
    reasonNote,
    createdAt: now,
    updatedAt: now,
  });
  await cashAudit(db, actorId, 'open', 'cash-reconciliations', id, {
    shiftId: s.id,
    reconciliationNo,
    reasonCode,
    reasonNote,
    difference,
  });
  return id;
}
export async function voidClosedCashEffect(db: CashDb, shiftId: string | null, actorId: string, reason: string) {
  if (!shiftId) return;
  const [s] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
  if (s?.closedAt) await reconciliationFor(db, s, actorId, 'post_close_void', reason);
}
export async function closeCashShift(
  db: CashDb,
  m: CashMember,
  id: string,
  b: Record<string, unknown>,
  reportOf: (db: CashDb, s: typeof posShifts.$inferSelect) => Promise<any>,
) {
  await cashLock(db);
  const [s] = await db
    .select()
    .from(posShifts)
    .where(and(eq(posShifts.id, id), eq(posShifts.memberId, m.id)))
    .for('update');
  if (!s) throw new AppError(404, 'Không tìm thấy ca của bạn.');
  if (s.reportSnapshot) return { ...JSON.parse(s.reportSnapshot), replayed: true };
  const totals = await cashShiftTotals(db, s.id);
  if (totals.pending.length)
    throw new AppError(409, 'Còn phiếu chờ duyệt, xử lý trước khi kết ca.', 'CASH_PENDING_APPROVAL');
  const countedCash = posMoney(b.countedCash, 'Tiền thực đếm'),
    report = await reportOf(db, s),
    cashDifference = countedCash - report.expectedCash,
    { reasonCode, reasonNote, differenceReason } = cashCloseReason(cashDifference, b.reasonCode, b.reasonNote),
    now = cashNow();
  const closed = {
    ...s,
    closedAt: now,
    countedCash,
    expectedCash: report.expectedCash,
    cashDifference,
    differenceReason,
    differenceReasonCode: reasonCode,
    differenceReasonNote: reasonNote,
  };
  const snapshot = { ...report, shift: closed, countedCash, cashDifference, differenceReason };
  await db
    .update(posShifts)
    .set({
      closedAt: now,
      countedCash,
      expectedCash: report.expectedCash,
      cashDifference,
      differenceReason,
      differenceReasonCode: reasonCode,
      differenceReasonNote: reasonNote,
      reportSnapshot: JSON.stringify(snapshot),
    })
    .where(eq(posShifts.id, s.id));
  if (cashDifference) await reconciliationFor(db, closed, m.id, reasonCode, reasonNote);
  await cashAudit(db, m.id, 'close', 'pos-shifts', s.id, {
    countedCash,
    expectedCash: report.expectedCash,
    cashDifference,
    reasonCode,
    reasonNote,
  });
  return { ...snapshot, replayed: false };
}
