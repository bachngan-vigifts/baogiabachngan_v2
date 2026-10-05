import { isSupplier, type Role } from '../../staff/domain/roles.ts';

/**
 * Ai thấy đơn NCC nào (port từ `listApprovedSupplierOrders`, thay cách so email bằng khoá ngoại `supplier_id`):
 *  - chỉ đơn `supplier-order` ĐÃ DUYỆT hiện ở trang NCC;
 *  - Manager: thấy tất cả, đủ giá;
 *  - Nhân viên: thấy tất cả nhưng ẨN giá/tiền (bản cũ);
 *  - Tài khoản NCC: CHỈ đơn của chính NCC mình (supplier_id khớp tài khoản NCC); chưa gắn NCC thì không thấy gì;
 *  - tài khoản bị khoá: không thấy gì.
 */
export type OrderVisibility = 'full' | 'prices-hidden' | 'none';
export interface PortalActor { id: string; role: Role; active: boolean; positionId?: string | null; supplierId?: string | null }
export interface PortalOrderRef { source: string; approvalStatus: string; supplierId: string | null }

export function orderVisibility(actor: PortalActor | null | undefined, order: PortalOrderRef | null | undefined): OrderVisibility {
  if (!actor?.active || !order) return 'none';
  if (order.source !== 'supplier-order' || order.approvalStatus !== 'approved') return 'none';
  if (isSupplier(actor)) return Boolean(actor.supplierId) && order.supplierId === actor.supplierId ? 'full' : 'none';
  if (actor.role === 'manager') return 'full';
  return 'prices-hidden';
}

export interface SqlScope { sql: string; bindings: (string | number | null)[] }

/** Điều kiện SQL lọc đơn hiện ở trang NCC (alias bảng `o` = incoming_shipments); luôn khớp với `orderVisibility`. */
export function portalOrderScope(actor: PortalActor | null | undefined): SqlScope {
  if (!actor?.active) return { sql: '0 = 1', bindings: [] };
  const base = "o.source = 'supplier-order' AND o.approval_status = 'approved'";
  if (isSupplier(actor)) return actor.supplierId ? { sql: `(${base} AND o.supplier_id = ?)`, bindings: [actor.supplierId] } : { sql: '0 = 1', bindings: [] };
  return { sql: `(${base})`, bindings: [] };
}
