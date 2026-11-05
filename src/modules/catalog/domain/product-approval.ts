import { AppError } from '../../../core/errors.ts';

/** Duyệt sản phẩm tạo trên web: nhân viên tạo → `pending` (ẩn khỏi danh mục báo giá), Manager duyệt → `approved`. Sản phẩm Sapo / file = approved. */
export const PRODUCT_APPROVAL_STATUSES = ['pending', 'approved'] as const;
export type ProductApproval = typeof PRODUCT_APPROVAL_STATUSES[number];

/** Policy IDs come from Sapo/imports; identify the two retail columns by their names. */
export function requireNewProductPrices(policies: { id: string; name: string }[], prices: Record<string, unknown>) {
  for (const [pattern, label] of [[/^gia(ban)?le$/, 'Giá bán lẻ'], [/^gia(ban)?levat$/, 'Giá lẻ +VAT']] as const) {
    const policy = policies.find(p => pattern.test(p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')));
    if (!policy) throw new AppError(400, `Chưa có bảng ${label}. Vui lòng cấu hình bảng giá trước khi tạo sản phẩm.`);
    const raw = prices[policy.id], value = Number(raw);
    if (!['number', 'string'].includes(typeof raw) || !Number.isSafeInteger(value) || value <= 0 || value > 1e12) {
      throw new AppError(400, `Bắt buộc nhập ${label} là số nguyên VNĐ lớn hơn 0 (tối đa 1.000.000.000.000đ).`);
    }
  }
}
