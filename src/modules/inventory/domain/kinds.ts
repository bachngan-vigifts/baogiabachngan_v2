/** Loại dòng phát sinh sổ kho và loại chứng từ gốc. */
export const STOCK_MOVE_KINDS = ['opening', 'receipt', 'issue', 'adjust', 'reverse', 'customer_return', 'sale', 'transfer_out', 'transfer_in'] as const;
export type StockMoveKind = typeof STOCK_MOVE_KINDS[number];
export const STOCK_REF_TYPES = ['opening', 'supplier_receipt', 'packing_slip', 'adjustment', 'pos_order', 'pos_delivery', 'pos_return', 'sales_order', 'stock_transfer', 'web_order'] as const;
export type StockRefType = typeof STOCK_REF_TYPES[number];
export const STOCK_KIND_LABEL: Record<StockMoveKind, string> = { opening: 'Tồn đầu kỳ', receipt: 'Nhập NCC', issue: 'Xuất đóng gói', adjust: 'Điều chỉnh', reverse: 'Huỷ chứng từ', customer_return: 'Khách trả hàng',
  sale: 'Bán hàng (đơn / HĐKT)', transfer_out: 'Chuyển kho đi', transfer_in: 'Chuyển kho đến' };
/** Diễn giải dòng sổ kho (cột "Giao dịch" của trang Sổ kho, như Sapo): theo loại phát sinh + loại chứng từ gốc. */
export function stockMoveDescription(kind: StockMoveKind, refType: StockRefType): string {
  switch (kind) {
    case 'opening': return 'Chốt tồn đầu kỳ';
    case 'receipt': return 'Nhập hàng vào kho';
    case 'issue': return refType === 'pos_delivery' ? 'Xuất kho giao hàng cho khách/shipper' : refType === 'web_order' ? 'Xuất kho đơn website (GHN đã lấy hàng)' : 'Xuất kho đóng gói giao hàng';
    case 'sale': return refType === 'pos_order' ? 'Xuất kho bán tại quầy' : 'Xuất kho bán hàng (duyệt đơn / HĐKT)';
    case 'customer_return': return 'Khách trả hàng – nhập lại kho';
    case 'adjust': return 'Điều chỉnh tồn kho';
    case 'transfer_out': return 'Chuyển hàng sang kho khác';
    case 'transfer_in': return 'Nhận hàng chuyển kho';
    case 'reverse': return refType === 'sales_order' ? 'Huỷ / sửa đơn – hoàn lại kho' : refType === 'supplier_receipt' ? 'Huỷ phiếu nhập hàng' : refType === 'web_order' ? 'Đơn website GHN hoàn về – nhập lại kho' : 'Huỷ chứng từ – ghi ngược';
  }
}
/** Phiếu điều chuyển kho: nhân viên xin → người duyệt duyệt / từ chối → Kho bấm "Đã chuyển" (trừ kho đi, cộng kho đến). */
export const TRANSFER_STATUSES = ['pending', 'approved', 'done', 'rejected', 'cancelled'] as const;
export type TransferStatus = typeof TRANSFER_STATUSES[number];
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt – chờ kho chuyển', done: 'Đã chuyển', rejected: 'Bị từ chối', cancelled: 'Đã huỷ' };
/** Ảnh nghiệp vụ kho (lưu kho file private, bảng chỉ giữ khoá): hàng NCC về bị hỏng, xác nhận đã giao cho khách. */
export const WAREHOUSE_PHOTO_REFS = ['supplier_receipt', 'delivery'] as const;
export type WarehousePhotoRef = typeof WAREHOUSE_PHOTO_REFS[number];
