import { documentDate } from '../../../core/document-number.ts';
/** Server-owned reservation in the existing QR cart JSON; legacy requests have no reserved number. */
export function reservedPosOrderNo(cart: string): string | null {
  try {
    const value: unknown = JSON.parse(cart).reservedOrderNo;
    if (typeof value !== 'string') return null;
    const old = /^POS_(\d{4})(\d{2})(\d{2})_\d{3,}$/.exec(value), current = /^POS_\d{3,}_(\d{2})(\d{2})(\d{4})$/.exec(value);
    if (!old && !current) return null;
    documentDate(old ? `${old[1]}-${old[2]}-${old[3]}` : `${current![3]}-${current![2]}-${current![1]}`);
    return value;
  } catch { return null; }
}
export function posQrContent(request: { id: string; cart: string }): string {
  const orderNo = reservedPosOrderNo(request.cart);
  return orderNo ? `Thanh toán đơn ${orderNo}` : 'POS ' + request.id.replaceAll('-', '').slice(0, 12);
}
export const normalizePosReference = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export function matchesPosQrReference(request: { id: string; cart: string }, normalized: string): boolean {
  const orderNo = reservedPosOrderNo(request.cart);
  const token = normalizePosReference(orderNo || 'POS ' + request.id.replaceAll('-', '').slice(0, 12));
  if (!orderNo) return normalized.includes(token); // QR issued before order-number reservations.
  let offset = normalized.indexOf(token);
  while (offset >= 0) {
    const after = normalized[offset + token.length] || '';
    if (!after || !(orderNo ? /[0-9]/ : /[A-F0-9]/).test(after)) return true;
    offset = normalized.indexOf(token, offset + token.length);
  }
  return false;
}

export const posQrOrderNumbers = (normalized: string): string[] => [...new Set((normalized.match(/POS[0-9]{11,}/g) || []).flatMap(token => {
  const digits = token.slice(3);
  return [`POS_${digits.slice(0, 8)}_${digits.slice(8)}`, `POS_${digits.slice(0, -8)}_${digits.slice(-8)}`]
    .filter(no => reservedPosOrderNo(JSON.stringify({ reservedOrderNo: no })) != null);
}))];
