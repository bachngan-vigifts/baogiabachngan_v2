import { and, eq, isNull } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { cashAudit, cashLock, voidClosedCashEffect, type CashDb } from './cash-store.ts';
import { cashTasksChanged } from './invoice-task-hooks.ts';
import { posRefunds, posReturns, posRefundCorrections } from '../return-schema.ts';
import { cashDrawers, cashEntries } from '../cash-schema.ts';
import { posShifts } from '../pos-schema.ts';
import { returnAccount, decideRefundMethod } from './pos-return-credit.ts';
import { posKey, posText } from './pos-store.ts';
import type { RefundMethod } from '../domain/pos-return-money.ts';

type Ctx = RouteContext<StaffEnv>;
const who = (c: Ctx) => (c.state.session as SessionState).member;
const fail = (status: number, message: string, code?: string): never => { throw new AppError(status, message, code); };
type Refund = typeof posRefunds.$inferSelect;
const snapshot = (r: Refund, entry?: typeof cashEntries.$inferSelect | null) => JSON.stringify({
  refundNo: r.refundNo, method: r.method, amount: r.amount, reference: r.reference, shiftId: r.shiftId, drawerId: r.drawerId,
  cashEntryId: r.cashEntryId, cashEntryStatus: entry?.status ?? null, sourcePaymentId: r.sourcePaymentId, overrideBy: r.overrideBy,
  voidedAt: r.voidedAt, replacedByRefundId: r.replacedByRefundId,
});

/**
 * Manager corrects a refund entered with the wrong method or voucher: the refund and its single drawer
 * entry are voided and, for a method change, replaced by exactly one correct refund. Drawer and shift
 * figures move in the same transaction; a closed shift keeps its snapshot and gets a reconciliation.
 * No compensating manual receipt/expense is ever created.
 */
export async function correctRefund(c: Ctx, tx: CashDb, refundId: string, b: Record<string, unknown>) {
  const m = who(c);
  if (m.role !== 'manager') fail(403, 'Chỉ Manager được sửa phiếu hoàn tiền.');
  const key = posKey(b.key), action = String(b.action || ''), reason = posText(b.reason, 1000).trim();
  const method = String(b.method || '') as RefundMethod, reference = posText(b.reference, 200).trim();
  const overrideEvidence = posText(b.evidence, 1000).trim();
  if (!['void', 'change_method'].includes(action)) fail(400, 'Chọn huỷ phiếu hoặc đổi phương thức.');
  if (reason.length < 10) fail(400, 'Nhập lý do sửa phiếu hoàn (ít nhất 10 ký tự).');
  if (action === 'change_method' && !['cash', 'transfer'].includes(method)) fail(400, 'Chọn phương thức đúng.');
  if (action === 'change_method' && method === 'transfer' && !reference) fail(400, 'Nhập mã giao dịch chuyển khoản đã hoàn cho khách.');
  const hash = await sha256Hex(JSON.stringify({ refundId, action, reason, method: action === 'change_method' ? method : '', reference, overrideEvidence }));
  await cashLock(tx);
  const [prior] = await tx.select().from(posRefundCorrections).where(eq(posRefundCorrections.requestKey, key));
  if (prior) {
    if (prior.requestHash !== hash || prior.createdBy !== m.id || prior.refundId !== refundId) fail(409, 'Mã thao tác đã dùng cho nội dung khác.');
    return { ...prior, replayed: true };
  }
  const [r] = await tx.select().from(posRefunds).where(eq(posRefunds.id, refundId)).for('update');
  if (!r) fail(404, 'Không tìm thấy phiếu hoàn.');
  if (r!.voidedAt) fail(409, 'Phiếu hoàn đã được sửa/huỷ trước đó.', 'REFUND_ALREADY_CORRECTED');
  if (action === 'change_method' && method === r!.method) fail(400, 'Phiếu đã đúng phương thức này.');
  const [ret] = await tx.select().from(posReturns).where(eq(posReturns.id, r!.returnId));
  const [entry] = r!.cashEntryId ? await tx.select().from(cashEntries).where(eq(cashEntries.id, r!.cashEntryId)).for('update') : [];
  if (r!.method === 'cash' && (!entry || entry.kind !== 'customer_refund' || entry.amount !== r!.amount || entry.drawerId !== r!.drawerId))
    fail(409, 'Phiếu chi két của phiếu hoàn không khớp; cần đối soát sổ quỹ trước.');
  const before = snapshot(r!, entry), at = new Date().toISOString();
  const voidReason = `Sửa phiếu hoàn ${r!.refundNo}: ${reason}`;
  await tx.update(posRefunds).set({ voidedAt: at, voidedBy: m.id, voidReason }).where(and(eq(posRefunds.id, r!.id), isNull(posRefunds.voidedAt)));
  if (entry && entry.status !== 'voided') {
    await tx.update(cashEntries).set({ status: 'voided', voidedBy: m.id, voidedAt: at, voidReason, updatedAt: at }).where(eq(cashEntries.id, entry.id));
    if (entry.status === 'posted') await voidClosedCashEffect(tx, entry.shiftId, m.id, `${entry.entryNo}: ${voidReason}`);
  }
  let replacement: Refund | null = null;
  if (action === 'change_method') {
    // The voided refund no longer counts; the replacement follows the same channel rules as any refund.
    const account = await returnAccount(tx, ret!.orderId);
    const source = await decideRefundMethod(tx, account, m, { method, amount: r!.amount, overrideReason: reason, overrideEvidence: overrideEvidence || reference });
    const id = crypto.randomUUID(), refundNo = r!.refundNo + '-S';
    let shiftId: string | null = null, cashEntryId: string | null = null;
    if (method === 'cash') {
      const [s] = await tx.select().from(posShifts).where(and(eq(posShifts.cashDrawerId, r!.drawerId), isNull(posShifts.closedAt))).for('update');
      if (!s) fail(409, 'Két của phiếu hoàn chưa có ca đang mở; mở ca rồi sửa để trừ đúng két.', 'REFUND_SHIFT_REQUIRED');
      const [drawer] = await tx.select().from(cashDrawers).where(eq(cashDrawers.id, r!.drawerId));
      shiftId = s!.id; cashEntryId = crypto.randomUUID();
      await tx.insert(cashEntries).values({ id: cashEntryId, entryNo: refundNo, drawerId: r!.drawerId, shiftId, kind: 'customer_refund', direction: 'out', amount: r!.amount,
        reason: `Hoàn ${ret!.returnNo} (sửa từ ${r!.refundNo}): ${reason}`, status: 'posted', approvalThresholdSnapshot: drawer!.approvalThreshold,
        createdBy: m.id, createdAt: at, approvedBy: m.id, approvedAt: at, requestKey: 'refund-correction:' + key, updatedAt: at });
    }
    const [inserted] = await tx.insert(posRefunds).values({ id, refundNo, returnId: r!.returnId, shiftId, drawerId: r!.drawerId, method, amount: r!.amount, cashEntryId,
      reference: method === 'transfer' ? reference : '', confirmationNote: `Sửa từ ${r!.refundNo}: ${reason}`, confirmedBy: m.id, confirmedAt: at,
      requestKey: 'refund-correction:' + key, createdAt: at, ...source }).returning();
    replacement = inserted!;
    await tx.update(posRefunds).set({ replacedByRefundId: id }).where(eq(posRefunds.id, r!.id));
  }
  const [after] = await tx.select().from(posRefunds).where(eq(posRefunds.id, r!.id));
  const [row] = await tx.insert(posRefundCorrections).values({
    id: crypto.randomUUID(), refundId: r!.id, action, replacementRefundId: replacement?.id ?? null, reason, beforeSnapshot: before,
    afterSnapshot: JSON.stringify({ voided: snapshot(after!, entry ? { ...entry, status: 'voided' } : null), replacement: replacement ? snapshot(replacement) : null }),
    createdBy: m.id, createdAt: at, requestKey: key, requestHash: hash,
  }).returning();
  await cashAudit(tx, m.id, 'correct-refund', 'pos-returns', r!.returnId, { refundId: r!.id, action, reason, replacementRefundId: replacement?.id ?? null, before: JSON.parse(before), method: replacement?.method ?? null });
  return row!;
}

export function registerRefundCorrectionRoutes(router: Router<StaffEnv>) {
  router.post('/refunds/:id/correct', async (c) => {
    const b = await readJson(c.req, 4000);
    const result = await c.env.db.transaction((tx) => correctRefund(c, tx, c.params.id!, b));
    if (!('replayed' in result)) await cashTasksChanged(c.env);
    return json(result, 201);
  }, 'business');
}
