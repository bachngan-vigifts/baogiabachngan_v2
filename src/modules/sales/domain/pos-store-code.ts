/** Mã cửa hàng trên số đơn POS (POS_ML_001_23112026 / POS_LOCK_001_23112026) để lọc theo cửa hàng.
 *  Cùng quy tắc tên với ranh giới cửa hàng ở pos-access.ts: kho có tên rõ một cửa hàng thì theo kho; kho chung/không rõ thì theo tên quầy.
 *  Không xác định được cửa hàng → giữ số cũ POS_001_23112026 (không đoán). */
export type PosStoreCode = 'LOCK' | 'ML';
export const POS_STORE_CODES: readonly PosStoreCode[] = ['LOCK', 'ML'];
const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
function storeOf(name: string): PosStoreCode | null | 'both' {
  const lock = name.includes('lock'), ml = name.includes('minh long');
  if (lock && ml) return 'both';
  return lock ? 'LOCK' : ml ? 'ML' : null;
}
export function posStoreCode(registerName: unknown, warehouseName: unknown): PosStoreCode | null {
  const w = storeOf(fold(warehouseName));
  if (w === 'LOCK' || w === 'ML') return w;
  const r = storeOf(fold(registerName));
  return r === 'LOCK' || r === 'ML' ? r : null;
}
export const posOrderPrefix = (code: PosStoreCode | null) => (code ? `POS_${code}` : 'POS');
