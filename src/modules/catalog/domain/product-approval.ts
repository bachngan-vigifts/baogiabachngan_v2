/** Duyệt sản phẩm tạo trên web: nhân viên tạo → `pending` (ẩn khỏi danh mục báo giá), Manager duyệt → `approved`. Sản phẩm Sapo / file = approved. */
export const PRODUCT_APPROVAL_STATUSES = ['pending', 'approved'] as const;
export type ProductApproval = typeof PRODUCT_APPROVAL_STATUSES[number];
