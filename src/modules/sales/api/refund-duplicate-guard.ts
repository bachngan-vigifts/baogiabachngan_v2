import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { posRefunds, posReturns } from '../return-schema.ts';
import type { CashDb } from './cash-store.ts';

const REFUND_CODE = /\bHT(?:-CRM)?-[A-Z0-9]{8}(?:-S)*\b/gi, RETURN_CODE = /\bTH(?:-CRM)?-[A-Z0-9]{8}\b/gi;
const REFUND_WORDS = /(hoàn|hoan|trả lại khách|tra lai khach|refund)/i;
const codes = (text: string, re: RegExp) => [...new Set((text.match(re) || []).map((x) => x.toUpperCase()))];

/**
 * Manual drawer entries must not record a customer refund a second time. A refund/return code in the text is a
 * certain duplicate: blocked, the refund flow is the only place to pay it. A same-amount cash refund from this
 * drawer in the last three days with refund wording is a likely duplicate: blocked until the user confirms it is
 * a different payment (the confirmation is audited by the caller).
 */
export async function assertNotRefundDuplicate(
  db: CashDb,
  drawerId: string,
  input: { kind: string; direction: string; amount: number; reason: string },
  confirmedDifferent: boolean,
) {
  if (input.kind === 'adjustment') return null;
  const refundCodes = codes(input.reason, REFUND_CODE), returnCodes = codes(input.reason, RETURN_CODE);
  if (refundCodes.length) {
    const hit = await db.select({ refundNo: posRefunds.refundNo }).from(posRefunds).where(and(inArray(posRefunds.refundNo, refundCodes), isNull(posRefunds.voidedAt)));
    if (hit.length) throw new AppError(409, `Nội dung trùng mã phiếu hoàn đã ghi nhận (${hit.map((h) => h.refundNo).join(', ')}). Không lập phiếu thu/chi thủ công cho khoản hoàn này; nếu phiếu hoàn sai, Manager dùng "Sửa phiếu hoàn".`, 'CASH_ENTRY_DUPLICATES_REFUND');
  }
  if (returnCodes.length) {
    const hit = await db.select({ returnNo: posReturns.returnNo }).from(posReturns).where(inArray(posReturns.returnNo, returnCodes));
    if (hit.length) throw new AppError(409, `Nội dung nhắc phiếu trả hàng ${hit.map((h) => h.returnNo).join(', ')}. Tiền hoàn của phiếu trả chỉ ghi qua chức năng Hoàn tiền của phiếu đó, không lập phiếu chi thủ công.`, 'CASH_ENTRY_DUPLICATES_REFUND');
  }
  if (input.direction !== 'out' || input.kind === 'cash_out' || !REFUND_WORDS.test(input.reason)) return null;
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const [similar] = await db.select({ refundNo: posRefunds.refundNo }).from(posRefunds)
    .where(and(eq(posRefunds.drawerId, drawerId), eq(posRefunds.method, 'cash'), eq(posRefunds.amount, input.amount), isNull(posRefunds.voidedAt), gte(posRefunds.confirmedAt, since))).limit(1);
  if (!similar) return null;
  if (!confirmedDifferent) throw new AppError(409, `Két này vừa có phiếu hoàn tiền mặt ${similar.refundNo} cùng số tiền. Nếu đây là khoản hoàn đó thì không lập phiếu chi; chỉ tiếp tục khi chắc chắn là khoản khác.`, 'CASH_ENTRY_SIMILAR_REFUND');
  return similar.refundNo;
}
