/** Server-owned reservation in the existing QR cart JSON; legacy requests have no reserved number. */
export function reservedPosOrderNo(cart: string): string | null {
  try {
    const value: unknown = JSON.parse(cart).reservedOrderNo;
    return typeof value === 'string' && /^POS_\d{8}_\d{3,}$/.test(value) ? value : null;
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

export const posQrOrderNumbers = (normalized: string): string[] => [...new Set((normalized.match(/POS[0-9]{11,}/g) || []).map(token => `POS_${token.slice(3, 11)}_${token.slice(11)}`))];
