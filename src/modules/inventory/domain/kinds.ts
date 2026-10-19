/** Loại dòng phát sinh sổ kho và loại chứng từ gốc. */
export const STOCK_MOVE_KINDS = ['opening', 'receipt', 'issue', 'adjust', 'reverse', 'customer_return'] as const;
export type StockMoveKind = typeof STOCK_MOVE_KINDS[number];
export const STOCK_REF_TYPES = ['opening', 'supplier_receipt', 'packing_slip', 'adjustment', 'pos_order', 'pos_delivery', 'pos_return'] as const;
export type StockRefType = typeof STOCK_REF_TYPES[number];
export const STOCK_KIND_LABEL: Record<StockMoveKind, string> = { opening: 'Tồn đầu kỳ', receipt: 'Nhập NCC', issue: 'Xuất đóng gói', adjust: 'Điều chỉnh', reverse: 'Huỷ chứng từ', customer_return: 'Khách trả hàng' };
/** Ảnh nghiệp vụ kho (lưu kho file private, bảng chỉ giữ khoá): hàng NCC về bị hỏng, xác nhận đã giao cho khách. */
export const WAREHOUSE_PHOTO_REFS = ['supplier_receipt', 'delivery'] as const;
export type WarehousePhotoRef = typeof WAREHOUSE_PHOTO_REFS[number];
