import { isRegistrationInvite } from './registration.ts';
import { nextDocumentNumber } from '../../../core/document-number.ts';
/** Quy tắc thuần của trang khách hàng (không DB/HTTP). */
import { AppError } from '../../../core/errors.ts';
import type { CustomerDiscounts } from '../../quotes/domain/quote-math.ts';

export const DISCOUNT_KEYS = ['minhLong', 'lys', 'lock'] as const;
export const DISCOUNT_LABELS: Record<typeof DISCOUNT_KEYS[number], string> = { minhLong: 'Minh Long', lys: 'Minh Long - Lys', lock: 'Lock&Lock' };

/**
 * Thương hiệu khách được xem / đặt: Minh Long, Minh Long I, Minh Long - LYS, LYS, Lock&Lock, Healthy Cook (Sứ dưỡng sinh). Thương hiệu khác bị chặn ở máy chủ.
 * So khớp bỏ dấu, hoa thường, khoảng trắng và ký tự nối (vd. "MINH LONG - LYS", "LocknLock", "Lock & Lock").
 */
const PORTAL_BRANDS = new Set(['minhlong', 'minhlongi', 'minhlonglys', 'lys', 'lock', 'locklock', 'locknlock', 'healthycook', 'suduongsinh', 'minhlongsuduongsinh']);
export const portalBrandAllowed = (brand: unknown) =>
  PORTAL_BRANDS.has(String(brand ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]/g, ''));

/** Chiết khấu riêng theo nhãn hàng: mỗi nhãn 0..100%, bỏ trống = 0. */
export function cleanDiscounts(v: unknown): CustomerDiscounts {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new AppError(400, 'Chiết khấu không hợp lệ.');
  const out: CustomerDiscounts = {};
  for (const k of DISCOUNT_KEYS) {
    const raw = (v as Record<string, unknown>)[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError(400, `Chiết khấu ${DISCOUNT_LABELS[k]} phải từ 0 đến 100%.`);
    if (n > 0) out[k] = Math.round(n * 100) / 100;
  }
  return out;
}
export const parseDiscounts = (s: string | null | undefined): CustomerDiscounts => { try { return cleanDiscounts(JSON.parse(s || '{}')); } catch { return {}; } };

/** Trường chỉ nội bộ công ty, không bao giờ gửi cho khách (giá nhập, chi phí in gia công, ghi chú nội bộ...). */
const PRIVATE_DOC_KEYS = ['printing', 'shipping', 'contractDocument', 'careStatus', 'careDueDate', 'careClosedAt', 'careNote', 'careAssigneeId', 'discountMode', 'internalNote'];
const PRIVATE_ROW_KEYS = ['purchaseDiscount', 'costPrice', 'commission', 'printing', 'pricePolicy', 'perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight'];
export function publicQuote(data: Record<string, any>) {
  const out: Record<string, any> = { ...data };
  for (const k of PRIVATE_DOC_KEYS) delete out[k];
  out.rows = (data.rows || []).map((r: Record<string, any>) => { const x = { ...r }; for (const k of PRIVATE_ROW_KEYS) delete x[k]; return x; });
  return out;
}

/** Portal and staff use the same quote numbering format and legacy compatibility. */
export function nextQuoteNo(prefix: string, ymd: string, used: readonly string[]) {
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  return nextDocumentNumber(prefix, date, used, `${prefix}${ymd}_`);
}

/**
 * Khách không có email: tài khoản đăng nhập bằng số di động; cột email (bắt buộc, duy nhất) giữ một địa chỉ nội bộ
 * `kh-…@sdt.invalid` (tên miền .invalid không bao giờ nhận thư) – giao diện không hiện địa chỉ này.
 */
export const PHONE_ONLY_DOMAIN = '@sdt.invalid';
export const isPhoneOnly = (email: string) => email.endsWith(PHONE_ONLY_DOMAIN);
/** Hiện cho người dùng: tài khoản chỉ có SĐT thì để trống email. */
export const shownEmail = (email: string) => (isPhoneOnly(email) || isRegistrationInvite(email) ? '' : email);
