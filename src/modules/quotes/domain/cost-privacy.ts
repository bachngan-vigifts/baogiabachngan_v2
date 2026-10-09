/**
 * GIÁ VỐN CHỈ MANAGER THẤY. Với nhân viên, máy chủ bỏ khỏi báo giá:
 *  - mỗi dòng: giá nhập (`costPrice`), % CK mua vào (`purchaseDiscount`), chi phí in gia công (`printing`), CK cho khách (`commission`);
 *  - cả báo giá: chi phí in gia công tổng (`printing`).
 * Nhân viên lưu báo giá (không có các trường này) → giữ nguyên giá trị cũ của dòng tương ứng (theo `id` dòng), dòng mới thì không có.
 * Hàm thuần.
 */
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const COST_ROW_KEYS = ['costPrice', 'purchaseDiscount', 'printing', 'commission'] as const;
export const COST_DOC_KEYS = ['printing'] as const;

/** Bản báo giá không có giá vốn (gửi cho nhân viên). */
export function withoutCosts<T extends Obj>(data: T): T {
  const out: Obj = { ...data };
  for (const k of COST_DOC_KEYS) delete out[k];
  out.rows = (Array.isArray(data.rows) ? data.rows : []).map((r: Obj) => { const x = { ...r }; for (const k of COST_ROW_KEYS) delete x[k]; return x; });
  return out as T;
}

/**
 * Dữ liệu nhân viên gửi lên → giữ giá vốn cũ: dòng có `id` trùng dòng cũ lấy lại các trường giá vốn của dòng cũ; dòng mới bỏ trống.
 * Nhân viên không tự đặt / đổi được giá vốn (mọi giá trị gửi lên đều bị thay bằng giá trị cũ).
 */
export function keepCosts(incoming: Obj, old: Obj | null): Obj {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const byId = new Map<string, Obj>((Array.isArray(old?.rows) ? old!.rows : []).filter((r: Obj) => r && r.id).map((r: Obj) => [String(r.id), r]));
  const out: Obj = { ...incoming };
  for (const k of COST_DOC_KEYS) { if (old && old[k] !== undefined) out[k] = old[k]; else delete out[k]; }
  if (Array.isArray(incoming.rows)) out.rows = incoming.rows.map((r: Obj) => {
    if (!r || typeof r !== 'object') return r;
    const was = r.id ? byId.get(String(r.id)) : undefined, x: Obj = { ...r };
    for (const k of COST_ROW_KEYS) { if (was && was[k] !== undefined) x[k] = was[k]; else delete x[k]; }
    return x;
  });
  return out;
}
