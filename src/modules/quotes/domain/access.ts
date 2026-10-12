import { isCustomer, isSupplier, type Role } from '../../staff/domain/roles.ts';

/**
 * Quyền sở hữu/chia sẻ báo giá (lớp cơ sở; API department-access.ts bổ sung quyền phòng ban từ DB):
 *  - CHỦ (`creatorId`) là người tạo và KHÔNG BAO GIỜ đổi, dù có ai khác cùng làm (DB có trigger chặn).
 *  - Mỗi báo giá có thể có NGƯỜI PHỤ TRÁCH (`assigneeId`, mặc định là chủ). Người phụ trách xem và sửa được.
 *    Người phụ trách được ƯU TIÊN: khi đã giao cho người khác thì chủ KHÔNG đè lên được, chỉ Manager đổi được.
 *    Khi chưa giao (chủ đang là người phụ trách) thì chủ giao được. Nếu người đang phụ trách không còn hợp lệ
 *    (bị khoá / chuyển sang NCC) thì chủ giao lại được để khỏi bế tắc. Người phụ trách không tự giao lại hay chia sẻ.
 *  - Nút "Chia sẻ": chủ/manager cho một nhân viên hoặc một chức vụ truy cập với quyền 'edit' (mặc định) hoặc 'view'.
 *    Người được chia sẻ không chia sẻ tiếp / thu hồi được. Khớp nhiều dòng chia sẻ thì quyền cao nhất thắng.
 *  - Manager xem, sửa, chia sẻ, đổi người phụ trách mọi báo giá.
 *  - Người bị khoá hoặc tài khoản NCC (vai trò hoặc chức vụ 'supplier') KHÔNG truy cập được báo giá nào,
 *    kể cả báo giá của mình hay đang được chia sẻ/giao phụ trách.
 *  - Quyền đồng nghiệp cùng nhóm được kiểm ở quotes/api/department-access.ts theo dữ liệu nhân viên đang hoạt động; lớp cơ sở này không đọc DB.
 */
export interface Viewer { id: string; role: Role; active: boolean; positionId?: string | null }
export interface QuoteOwnership { id: string; creatorId: string; assigneeId?: string | null }
export interface QuoteShareTarget { targetType: 'member' | 'position'; targetId: string; permission: 'view' | 'edit' }

/** Người dùng không được chạm vào báo giá nào. */
// NCC và khách hàng không dùng phạm vi báo giá của nhân viên (khách xem báo giá của mình qua API trang khách hàng).
const barred = (v: Viewer | null | undefined): v is null | undefined => !v?.active || isSupplier(v) || isCustomer(v);

const matches = (viewer: Viewer, s: QuoteShareTarget): boolean =>
  (s.targetType === 'member' && s.targetId === viewer.id)
  || (s.targetType === 'position' && Boolean(viewer.positionId) && s.targetId === viewer.positionId);

const isManager = (v: Viewer) => v.role === 'manager';
const isOwner = (v: Viewer, q: QuoteOwnership) => v.id === q.creatorId;
const isAssignee = (v: Viewer, q: QuoteOwnership) => q.assigneeId != null && v.id === q.assigneeId;

/** Người phụ trách hiệu lực: chưa chỉ định thì là chủ. */
export const effectiveAssigneeId = (q: Pick<QuoteOwnership, 'creatorId' | 'assigneeId'>): string => q.assigneeId ?? q.creatorId;

/** `shares` = các dòng quote_shares CỦA CHÍNH báo giá này. */
export function canViewQuotation(viewer: Viewer | null | undefined, quote: QuoteOwnership | null | undefined, shares: readonly QuoteShareTarget[] = []): boolean {
  if (barred(viewer) || !quote) return false;
  return isManager(viewer) || isOwner(viewer, quote) || isAssignee(viewer, quote) || shares.some(s => matches(viewer, s));
}

export function canEditQuotation(viewer: Viewer | null | undefined, quote: QuoteOwnership | null | undefined, shares: readonly QuoteShareTarget[] = []): boolean {
  if (barred(viewer) || !quote) return false;
  return isManager(viewer) || isOwner(viewer, quote) || isAssignee(viewer, quote) || shares.some(s => s.permission === 'edit' && matches(viewer, s));
}

/** Chia sẻ / đổi quyền / thu hồi chia sẻ: chỉ chủ báo giá và manager. */
export function canShareQuotation(viewer: Viewer | null | undefined, quote: QuoteOwnership | null | undefined): boolean {
  if (barred(viewer) || !quote) return false;
  return isManager(viewer) || isOwner(viewer, quote);
}

/**
 * Đổi người phụ trách. Manager luôn được. Chủ chỉ được khi báo giá CHƯA giao cho ai khác
 * (người phụ trách hiệu lực chính là chủ) hoặc người đang phụ trách không còn hợp lệ (`currentAssigneeUsable=false`).
 * Người phụ trách hiện tại (không phải chủ) và mọi người khác thì không.
 */
export function canReassignQuotation(viewer: Viewer | null | undefined, quote: QuoteOwnership | null | undefined, currentAssigneeUsable = true): boolean {
  if (barred(viewer) || !quote) return false;
  if (isManager(viewer)) return true;
  return isOwner(viewer, quote) && (effectiveAssigneeId(quote) === quote.creatorId || !currentAssigneeUsable);
}

export interface SqlScope { sql: string; bindings: (string | number | null)[] }

const shareClause = (permission: 'any' | 'edit') =>
  `EXISTS (SELECT 1 FROM quote_shares s WHERE s.quote_id = q.id${permission === 'edit' ? " AND s.permission = 'edit'" : ''} AND ((s.target_type = 'member' AND s.target_id = ?) OR (s.target_type = 'position' AND s.target_id = ?)))`;

function scope(viewer: Viewer | null | undefined, permission: 'any' | 'edit'): SqlScope {
  if (barred(viewer)) return { sql: '0 = 1', bindings: [] };
  if (isManager(viewer)) return { sql: '1 = 1', bindings: [] };
  return {
    sql: `(q.creator_id = ? OR q.assignee_id = ? OR ${shareClause(permission)})`,
    // positionId null → so sánh với NULL luôn sai, nên người chưa có chức vụ không bao giờ khớp chia sẻ theo chức vụ.
    bindings: [viewer.id, viewer.id, viewer.id, viewer.positionId ?? null],
  };
}

/**
 * Điều kiện SQL lọc báo giá được XEM (alias bảng `q` = staff_quotations). Dùng chung cho danh sách,
 * chi tiết và xuất file; API dùng quotationPredicate để bổ sung quyền phòng ban.
 */
export const quotationScope = (viewer: Viewer | null | undefined): SqlScope => scope(viewer, 'any');

/** Điều kiện SQL báo giá được SỬA. Câu UPDATE phải kèm điều kiện này để chặn sửa vượt quyền ngay ở tầng DB. */
export const quotationEditScope = (viewer: Viewer | null | undefined): SqlScope => scope(viewer, 'edit');

