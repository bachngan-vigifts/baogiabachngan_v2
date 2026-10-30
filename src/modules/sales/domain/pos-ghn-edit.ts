import { AppError } from '../../../core/errors.ts';
export const GHN_EDITABLE = new Set(['ready_to_pick', 'picking']);
export interface GhnEditItem { name: string; code: string; quantity: number; price: number }
export interface GhnEditTarget { cod: number; items: GhnEditItem[]; content: string }
export interface GhnEditPreviewLine { id?: string; sku: string; name: string; unit: string; qty: number; price: number; taxRate: number; discountType: string; discountValue: number; gross: number }
export interface GhnAmendment {
  version: 1; id: string; key: string; hash: string; revision: number; orderNo: string; deliveryId: string; trackingCode: string;
  actorId: string; request: Record<string, unknown>; lines: GhnEditPreviewLine[]; target: GhnEditTarget;
  reserve: { sku: string; qty: number }[]; carrierWriteStarted?: boolean; before?: GhnEditTarget; lease: string; leaseUntil: number; error?: string;
}
export function posSnapshot(value: unknown): Record<string, any> {
  try { const data = typeof value === 'string' ? JSON.parse(value || '{}') : value; return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
export function pendingGhnEdit(value: unknown): GhnAmendment | null {
  const edit = posSnapshot(value).ghnAmendment;
  return edit?.version === 1 && typeof edit.key === 'string' ? edit : null;
}
export function ghnTarget(lines: GhnEditPreviewLine[], cod: number): GhnEditTarget {
  return { cod: Math.round(cod), content: lines.map(l => l.name).join(', ').slice(0, 2000), items: lines.map(l => ({ name: l.name.slice(0, 200), code: l.sku.slice(0, 100), quantity: Math.max(1, Math.ceil(l.qty)), price: Math.max(0, Math.round(l.gross / l.qty)) })) };
}
export function sameGhnItems(a: GhnEditTarget, b: GhnEditTarget) {
  const normalize = (items: GhnEditItem[]) => items.map(i => [i.code, Number(i.quantity), Number(i.price)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify(normalize(a.items)) === JSON.stringify(normalize(b.items));
}
export const sameGhnTarget = (a: GhnEditTarget, b: GhnEditTarget) => a.cod === b.cod && sameGhnItems(a, b);
/** Keep both original and desired goods reserved until the carrier and CRM agree. */
export function extraGhnReservations(old: {sku: string; qty: number}[], next: {sku: string; qty: number}[]) {
  const previous = new Map<string, number>(), desired = new Map<string, number>();
  for (const l of old) previous.set(l.sku, (previous.get(l.sku) || 0) + l.qty);
  for (const l of next) desired.set(l.sku, (desired.get(l.sku) || 0) + l.qty);
  return [...desired].flatMap(([sku, qty]) => qty > (previous.get(sku) || 0) ? [{ sku, qty: qty - (previous.get(sku) || 0) }] : []);
}

export function assertNoPendingGhnEdit(value: unknown) {
  if (pendingGhnEdit(value)) throw new AppError(409, 'Đơn đang chờ hoàn tất sửa GHN; chưa thu tiền, đóng gói hoặc xuất/giao. Mở Sửa đơn POS để tiếp tục.', 'GHN_EDIT_PENDING');
}
