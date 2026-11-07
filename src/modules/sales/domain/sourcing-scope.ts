import { LOCK_CATALOG_PATTERN, MINH_LONG_CATALOG_PATTERN } from './pos-catalog-brand.ts';

/**
 * BƯỚC RÀ NGUỒN HÀNG trước khi sinh đơn hàng / HĐKT (07/11/2026) chỉ áp dụng cho hàng Minh Long (Minh Long, Minh Long Lys,
 * Minh Long Healthy Cook, Minh Long I / 1) và Lock&Lock (Lock, LocknLock, Lock&Lock). Mã ngoài danh mục bỏ qua bước này.
 * Xét theo thương hiệu của sản phẩm; sản phẩm chưa ghi thương hiệu thì xét theo tên (cùng quy tắc nhận diện với POS).
 */
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const MINH_LONG = new RegExp(MINH_LONG_CATALOG_PATTERN), LOCK = new RegExp(LOCK_CATALOG_PATTERN);
export function needsSourcing(product: { brand?: unknown; name?: unknown } | null | undefined): boolean {
  if (!product) return false;
  const text = normalize(String(product.brand ?? '').trim() || product.name);
  return MINH_LONG.test(text) || LOCK.test(text);
}
export const SOURCING_SCOPE_LABEL = 'Minh Long / Lock&Lock';
