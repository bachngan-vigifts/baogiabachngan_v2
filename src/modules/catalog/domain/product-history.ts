/**
 * Lịch sử sản phẩm: mọi biến động của một mã hàng (một chỗ để sửa loại / nhãn / giới hạn).
 * - Từ web: bán (đơn đặt hàng xác nhận), xuất kho giao hàng (chuyến giao "Đã giao").
 * - Từ Sapo (chứng từ kho đồng bộ): nhập hàng, điều chuyển, cân bằng / kiểm kho, khách trả hàng, trả hàng nhà cung cấp.
 */
export const PRODUCT_MOVE_KINDS = ['sale', 'delivery', 'purchase', 'transfer', 'adjustment', 'customer_return', 'supplier_return'] as const;
export type ProductMoveKind = typeof PRODUCT_MOVE_KINDS[number];
/** Số dòng mỗi trang lịch sử (lịch sử nhanh); mọi phát sinh đều được giữ, "Xem thêm" nạp trang cũ hơn. */
export const PRODUCT_HISTORY_LIMIT = 20;
/** Chiều của số lượng: in = cộng kho, out = trừ kho, none = không đổi tổng (bán chưa xuất, điều chuyển giữa kho), signed = theo dấu (cân bằng kho). */
export const MOVE_DIRECTION: Record<ProductMoveKind, 'in' | 'out' | 'none' | 'signed'> = {
  sale: 'none', delivery: 'out', purchase: 'in', transfer: 'none', adjustment: 'signed', customer_return: 'in', supplier_return: 'out',
};
