/** Tiền Việt Nam đồng không có phần thập phân: luôn làm tròn về số nguyên. */
export const roundVnd = (value: number): number => Math.round(value);

/** Ép về số hữu hạn; giá trị không hợp lệ (NaN, Infinity, null, chuỗi rác) thành `fallback`. */
export const toFinite = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const clampPercent = (value: unknown): number => Math.min(100, Math.max(0, toFinite(value)));
