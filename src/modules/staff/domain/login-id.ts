/**
 * Định danh đăng nhập: email (mọi tài khoản) hoặc số điện thoại (tài khoản khách hàng).
 * Số điện thoại chuẩn hoá về dạng 0xxxxxxxxx: bỏ ký tự không phải số, +84 / 84 đầu số → 0.
 */
export function normalizePhone(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
  if (!d.startsWith('0') && d.length === 9) d = '0' + d;
  return /^0\d{8,10}$/.test(d) ? d : '';
}
export type LoginId = { kind: 'email'; value: string } | { kind: 'phone'; value: string } | { kind: 'invalid'; value: string };
/** Có "@" là email; còn lại thử đọc như số điện thoại. */
export function parseLoginId(raw: unknown): LoginId {
  const s = String(raw ?? '').trim();
  if (s.includes('@')) return { kind: 'email', value: s.toLowerCase() };
  const phone = normalizePhone(s);
  return phone ? { kind: 'phone', value: phone } : { kind: 'invalid', value: s.toLowerCase() };
}
