import { AppError, forbidden } from '../../../core/errors.ts';
import { isSupplier, type Role } from '../../staff/domain/roles.ts';
import { canReassignQuotation, canShareQuotation, effectiveAssigneeId, type QuoteOwnership, type QuoteShareTarget, type Viewer } from './access.ts';

/** Một dòng trong danh bạ nhân viên (lấy từ module staff). */
export interface StaffEntry { id: string; name: string; role: Role; active: boolean; positionId?: string | null }

/** Danh sách cho phép chọn người phụ trách / người nhận chia sẻ: nhân viên đang hoạt động, KHÔNG gồm tài khoản NCC. */
export const assignableStaff = (directory: readonly StaffEntry[]): StaffEntry[] =>
  directory.filter(m => m.active && !isSupplier(m)).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

export interface ReassignPlan {
  /** Giá trị ghi vào cột assignee_id: null khi người phụ trách chính là chủ (chỉ một cách biểu diễn). */
  assigneeId: string | null;
  changed: boolean;
  audit: { action: 'quote.reassign'; from: string; to: string };
}

/** Kiểm tra và lập kế hoạch đổi người phụ trách. Không đụng DB; repo ghi kết quả + audit_logs trong một giao dịch. */
export function planReassignment(actor: Viewer | null | undefined, quote: QuoteOwnership, newAssigneeId: string, directory: readonly StaffEntry[]): ReassignPlan {
  const from = effectiveAssigneeId(quote);
  const usable = assignableStaff(directory).some(m => m.id === from);
  if (!canReassignQuotation(actor, quote, usable)) {
    throw forbidden(from === quote.creatorId ? 'Chỉ chủ báo giá hoặc Manager được đổi người phụ trách.' : 'Báo giá đã giao cho người khác phụ trách; chỉ Manager được đổi người phụ trách.');
  }
  if (!assignableStaff(directory).some(m => m.id === newAssigneeId)) throw new AppError(400, 'Nhân viên được chọn không hợp lệ hoặc không thể phụ trách báo giá.');
  return {
    assigneeId: newAssigneeId === quote.creatorId ? null : newAssigneeId,
    changed: newAssigneeId !== from,
    audit: { action: 'quote.reassign', from, to: newAssigneeId },
  };
}

export interface ShareInput { targetType: 'member' | 'position'; targetId: string; permission?: 'view' | 'edit' }

/** Kiểm tra yêu cầu chia sẻ; trả về dòng chuẩn hoá để ghi vào quote_shares. */
export function planShare(actor: Viewer | null | undefined, quote: QuoteOwnership, input: ShareInput, directory: readonly StaffEntry[], positionIds: readonly string[]): QuoteShareTarget {
  if (!canShareQuotation(actor, quote)) throw forbidden('Chỉ chủ báo giá hoặc Manager được chia sẻ báo giá.');
  const permission = input.permission ?? 'edit';
  if (permission !== 'view' && permission !== 'edit') throw new AppError(400, 'Quyền chia sẻ không hợp lệ.');
  if (input.targetType === 'member') {
    if (input.targetId === quote.creatorId) throw new AppError(400, 'Không cần chia sẻ báo giá cho chính chủ báo giá.');
    if (!assignableStaff(directory).some(m => m.id === input.targetId)) throw new AppError(400, 'Nhân viên được chọn không hợp lệ hoặc không thể nhận chia sẻ.');
  } else if (input.targetType === 'position') {
    if (!positionIds.includes(input.targetId)) throw new AppError(400, 'Chức vụ được chọn không tồn tại.');
    if (isSupplier({ role: 'employee', positionId: input.targetId })) throw new AppError(400, 'Không thể chia sẻ báo giá cho chức vụ NCC.');
  } else throw new AppError(400, 'Đối tượng chia sẻ không hợp lệ.');
  return { targetType: input.targetType, targetId: input.targetId, permission };
}
