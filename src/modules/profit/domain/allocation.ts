/**
 * Phân bổ một khoản tiền theo trọng số – GIỮ NGUYÊN TỔNG (đồng nguyên): làm tròn xuống từng phần, phần dư chia theo phần lẻ lớn nhất
 * (bằng nhau thì theo trọng số lớn hơn, rồi thứ tự). Không có trọng số dương → không phân bổ (trả null, khoản đó "chưa phân bổ").
 */
export function allocate(total: number, weights: readonly number[]): number[] | null {
  const t = Math.round(total), sum = weights.reduce((n, w) => n + (w > 0 ? w : 0), 0);
  if (!weights.length || sum <= 0) return null;
  const raw = weights.map(w => (w > 0 ? w : 0) * t / sum), base = raw.map(x => Math.floor(x));
  let rest = t - base.reduce((n, x) => n + x, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x), w: weights[i]! })).sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k]!.i]!++;
  for (let k = 0; rest < 0; k = (k + 1) % order.length, rest++) base[order[k]!.i]!--;
  return base;
}
/** Tháng trọn vẹn nằm trong [from, to] (chi phí kỳ lương chỉ tính cho tháng trọn để không cắt nửa tháng lương). */
export function fullMonths(from: string, to: string, limit = 24) {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  if (from.slice(8, 10) !== '01') { m++; if (m > 12) { m = 1; y++; } }
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (last > to || out.length >= limit) break;
    out.push(month); m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export const isMonthEnd = (day: string) => { const [y, m] = day.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) === day; };
