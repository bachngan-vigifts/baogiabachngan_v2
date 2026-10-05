/** Làm tròn số lượng về số nguyên, nửa ra xa số 0 (giống `stockInteger` bản cũ). */
export const stockInteger = (n: number): number => Math.sign(n) * Math.floor(Math.abs(n) + 0.5);

/** `Number(x) || 0` – giá trị rác thành 0 (cách bản cũ đọc số lượng/đơn giá). */
export const numOrZero = (v: unknown): number => Number(v) || 0;

/**
 * Ngày YYYY-MM-DD hợp lệ THẬT. Khác bản cũ: bản cũ chỉ kiểm `Date.parse`, mà JavaScript tự cuốn ngày không tồn tại
 * (vd 31/02 → 03/03) nên bản cũ nhận cả "2026-02-31". Ở đây ngày phải quay về đúng chuỗi ban đầu.
 */
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};
