import { isSupplier, type Role } from '../../staff/domain/roles.ts';

/**
 * Máy trạng thái của đơn NCC: ai được làm gì, lúc nào. Trang NCC dùng `nextActions()` để biết nút nào hiện/ẩn;
 * API dùng `checkAction()` để từ chối thao tác sai (hai hàm luôn cùng một nguồn nên giao diện và máy chủ không lệch nhau).
 * Thứ tự kiểm tra và thông báo lỗi giữ như bản cũ (`updateSupplierPortalOrder` và các hàm quanh nó).
 *
 * Vòng đời:  chờ duyệt ──duyệt (Manager)──▶ chờ NCC xác nhận ──NCC xác nhận──▶ đã xác nhận ──nhập kho (Manager)──▶ đã nhập kho
 * Song song (không đổi giai đoạn): ký/tải bản ký · số phiếu nội bộ · yêu cầu cọc → Manager ghi nhận thanh toán cọc · báo sẵn sàng giao.
 */
export type OrderAction =
  | 'approve' | 'set_internal_number' | 'upload_signature' | 'delete_signature' | 'confirm'
  | 'request_deposit' | 'pay_deposit' | 'mark_delivery_ready' | 'unmark_delivery_ready' | 'receive';
export const ALL_ACTIONS: readonly OrderAction[] = ['approve', 'set_internal_number', 'upload_signature', 'delete_signature', 'confirm', 'request_deposit', 'pay_deposit', 'mark_delivery_ready', 'unmark_delivery_ready', 'receive'];

export interface OrderFacts {
  source: string; approvalStatus: string; supplierId: string | null;
  confirmed: boolean;
  /** Đã tải lên file bản ký HOẶC NCC đã tải mẫu về (bản cũ coi cả hai là đã qua bước ký). */
  hasSignatureStep: boolean;
  /** Đã có file bản ký tải lên (khác `hasSignatureStep`). */
  hasSignatureFile: boolean;
  depositRequested: boolean; depositPaid: boolean; deliveryReady: boolean; received: boolean;
}
export interface WorkflowActor { id: string; role: Role; active: boolean; positionId?: string | null; supplierId?: string | null }

/**
 * Ba "siết chặt" so với bản cũ, mặc định BẬT vì bản cũ cho làm những việc vô lý; tắt bằng cách truyền cờ = false.
 * `depositRequiresConfirmation` mặc định TẮT (bản cũ cho yêu cầu cọc trước khi xác nhận – chưa rõ có chủ ý) – cần chủ dự án quyết định.
 */
export interface Rules {
  /** Sau khi đã nhập kho, NCC không còn đổi bản ký / xác nhận / yêu cầu cọc / báo giao. (Vẫn sửa được số phiếu nội bộ; Manager vẫn ghi nhận cọc.) */
  freezeAfterReceipt: boolean;
  /** Đã xác nhận thì không xoá hay thay bản ký (xác nhận dựa trên bản ký; tải bản mới lên cũng là thay bản cũ). */
  lockSignatureAfterConfirm: boolean;
  /** Không nhập kho đơn NCC chưa được duyệt. */
  receiveRequiresApproval: boolean;
  /** Phải xác nhận đơn trước khi yêu cầu đặt cọc. */
  depositRequiresConfirmation: boolean;
}
export const DEFAULT_RULES: Rules = { freezeAfterReceipt: true, lockSignatureAfterConfirm: true, receiveRequiresApproval: true, depositRequiresConfirmation: false };
/** Đúng hành vi bản cũ (dùng để đối chiếu). */
export const LEGACY_RULES: Rules = { freezeAfterReceipt: false, lockSignatureAfterConfirm: false, receiveRequiresApproval: false, depositRequiresConfirmation: false };

export type Check = { ok: true; noop?: boolean } | { ok: false; status: number; message: string };
const no = (status: number, message: string): Check => ({ ok: false, status, message });
const OK: Check = { ok: true };

const PORTAL_ACTIONS: ReadonlySet<OrderAction> = new Set(['set_internal_number', 'upload_signature', 'delete_signature', 'confirm', 'request_deposit', 'mark_delivery_ready', 'unmark_delivery_ready']);

export function checkAction(action: OrderAction, actor: WorkflowActor | null | undefined, order: OrderFacts, rules: Rules = DEFAULT_RULES): Check {
  if (!actor?.active) return no(403, 'Tài khoản đã bị khoá.');
  const supplier = isSupplier(actor), manager = actor.role === 'manager' && !supplier;

  if (action === 'approve') {
    if (!manager) return no(403, 'Chỉ Manager được phê duyệt đơn đặt hàng NCC.');
    if (order.source !== 'supplier-order') return no(404, 'Không tìm thấy đơn đặt hàng NCC.');
    if (order.approvalStatus === 'approved') return no(409, 'Đơn này đã được phê duyệt.');
    if (order.received) return no(409, 'Đơn này đã nhập kho.');
    return OK;
  }

  if (action === 'receive') {
    if (!manager) return no(403, 'Chỉ Manager được xác nhận nhập kho.');
    if (order.received) return { ok: true, noop: true }; // bản cũ: nhập kho lần hai trả "đã nhập" chứ không báo lỗi
    if (rules.receiveRequiresApproval && order.source === 'supplier-order' && order.approvalStatus !== 'approved') return no(409, 'Đơn NCC chưa được duyệt, chưa thể nhập kho.');
    return OK;
  }

  if (action === 'pay_deposit') {
    if (!manager) return no(403, 'Chỉ Manager được ghi nhận thanh toán cọc NCC.');
    if (order.source !== 'supplier-order' || order.approvalStatus !== 'approved') return no(404, 'Không tìm thấy đơn NCC đã gửi.');
    if (!order.depositRequested) return no(400, 'Đơn này chưa có đề nghị thanh toán.');
    return OK;
  }

  // Các thao tác ở cổng NCC: chỉ NCC (đúng NCC của đơn) và Manager.
  if (!PORTAL_ACTIONS.has(action)) return no(400, 'Thao tác không hợp lệ.');
  if (!(manager || supplier)) return no(403, 'Chỉ tài khoản NCC được xác nhận đơn NCC.');
  if (order.source !== 'supplier-order' || order.approvalStatus !== 'approved') return no(404, 'Không tìm thấy đơn NCC đã gửi.');
  if (supplier && !(actor.supplierId && order.supplierId === actor.supplierId)) return no(404, 'Không tìm thấy đơn NCC của tài khoản này.');

  const frozen = rules.freezeAfterReceipt && order.received && action !== 'set_internal_number';
  if (frozen) return no(409, 'Đơn đã nhập kho, không thể thay đổi.');

  switch (action) {
    case 'confirm':
      if (order.confirmed) return no(409, 'Đơn này đã được NCC xác nhận.');
      if (!order.hasSignatureStep) return no(400, 'Vui lòng upload ảnh hoặc file bản ký xác nhận trước khi bấm Xác nhận.');
      return OK;
    case 'delete_signature':
      if (rules.lockSignatureAfterConfirm && order.confirmed) return no(409, 'Đơn đã được NCC xác nhận, không thể xoá bản ký.');
      return OK;
    case 'upload_signature':
      if (rules.lockSignatureAfterConfirm && order.confirmed) return no(409, 'Đơn đã được NCC xác nhận, không thể thay bản ký.');
      return OK;
    case 'request_deposit':
      if (order.depositPaid) return no(409, 'Đơn này đã nhận tiền cọc.');
      if (rules.depositRequiresConfirmation && !order.confirmed) return no(409, 'Cần xác nhận đơn trước khi yêu cầu đặt cọc.');
      return OK;
    case 'mark_delivery_ready':
      if (!order.confirmed) return no(409, 'Chỉ đơn đã duyệt mới được báo sẵn sàng giao.');
      if (order.received) return no(409, 'Đơn đã nhập kho, không cần báo sẵn sàng giao.');
      return OK;
    default:
      return OK; // set_internal_number, unmark_delivery_ready
  }
}

/** Các nút đang dùng được cho người này trên đơn này (loại trừ thao tác "không có gì để làm"). */
export function nextActions(actor: WorkflowActor | null | undefined, order: OrderFacts, rules: Rules = DEFAULT_RULES): OrderAction[] {
  return ALL_ACTIONS.filter(a => {
    const c = checkAction(a, actor, order, rules);
    if (!c.ok || c.noop) return false;
    if (a === 'unmark_delivery_ready') return order.deliveryReady;
    if (a === 'delete_signature') return order.hasSignatureFile;
    return true;
  });
}

export type OrderStage = 'pending_approval' | 'awaiting_confirmation' | 'confirmed' | 'received';
/** Giai đoạn hiển thị chính (huy hiệu/bộ lọc). Các cờ cọc/giao hàng hiển thị riêng bên cạnh. */
export function orderStage(order: Pick<OrderFacts, 'approvalStatus' | 'confirmed' | 'received'>): OrderStage {
  if (order.received) return 'received';
  if (order.approvalStatus !== 'approved') return 'pending_approval';
  return order.confirmed ? 'confirmed' : 'awaiting_confirmation';
}
