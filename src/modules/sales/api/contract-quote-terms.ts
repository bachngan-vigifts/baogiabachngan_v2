import { and, eq } from 'drizzle-orm';
import { auditLogs } from '../../../core/db/schema.ts';
import { AppError } from '../../../core/errors.ts';
import { quotations, quoteRevisions } from '../../quotes/schema.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { quoteWithContractTerms, type ContractQuoteTerms } from '../domain/contract-quote-terms.ts';
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
/** Runs inside the same transaction as the contract and receivable updates. Never resaves product rows. */
export async function syncContractQuoteTerms(tx: Tx, quoteId: string | null, contractId: string, revision: unknown, changes: ContractQuoteTerms, member: SessionState['member']) {
  if (!quoteId) return null;
  if (!Number.isSafeInteger(revision)) throw new AppError(409, 'Mở lại hồ sơ để lấy phiên bản báo giá trước khi lưu.', 'QUOTE_CHANGED');
  const [quote] = await tx.select().from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(member, true))).limit(1);
  if (!quote) throw new AppError(403, 'Không có quyền cập nhật báo giá nguồn.');
  if (quote.revision !== revision) throw new AppError(409, 'Báo giá nguồn đã thay đổi. Đóng và mở lại hồ sơ trước khi lưu.', 'QUOTE_CHANGED');
  const data = quoteWithContractTerms(JSON.parse(quote.data), changes), encoded = JSON.stringify(data);
  if (encoded === quote.data) return quote.revision;
  if (quote.approvalStatus === 'approved' && member.role !== 'manager') throw new AppError(403, 'Báo giá đã duyệt. Chỉ Manager được cập nhật điều khoản từ HĐKT.', 'QUOTE_APPROVED');
  const now = new Date().toISOString(), next = quote.revision + 1;
  const updated = await tx.update(quotations).set({ data: encoded, revision: next, updatedAt: now })
    .where(and(eq(quotations.id, quote.id), eq(quotations.revision, quote.revision))).returning({ id: quotations.id });
  if (!updated.length) throw new AppError(409, 'Báo giá vừa được sửa ở nơi khác. Mở lại hồ sơ trước khi lưu.', 'QUOTE_CHANGED');
  await tx.insert(quoteRevisions).values({ id: crypto.randomUUID(), quoteId: quote.id, revision: quote.revision, data: quote.data, changedBy: member.id, createdAt: now });
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: member.id, module: 'sales', action: 'contract-quote-terms', entityType: 'staff_quotations', entityId: quote.id,
    data: JSON.stringify({ contractId, fromRevision: quote.revision, toRevision: next, terms: changes }), createdAt: now });
  return next;
}
