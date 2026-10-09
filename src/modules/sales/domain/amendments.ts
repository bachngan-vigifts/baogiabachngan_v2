import type { OrderLineDraft, ScheduleDraft } from './sales.ts';

export interface ExistingLine extends OrderLineDraft { id: string; deliveredQty: number }
/** Giữ ID dòng đã có chứng từ; đối chiếu mã hàng, hoặc tên + đơn vị nếu chưa có mã. */
export function amendmentLines(existing: ExistingLine[], next: OrderLineDraft[], reserved: Map<string, number>, referenced: Set<string>) {
  const unused = new Set(existing);
  const identity = (l: OrderLineDraft) => JSON.stringify([l.sku || l.name, l.unit]);
  const updates = next.map(line => {
    const candidates = [...unused].filter(old => identity(old) === identity(line));
    const old = candidates.find(x => x.lineNo === line.lineNo) || candidates[0];
    if (!old) return { ...line, id: null, deliveredQty: 0 };
    unused.delete(old);
    if (line.qty < Math.max(old.deliveredQty, reserved.get(old.id) || 0))
      throw new Error(`Không thể giảm số lượng "${old.name}" dưới số đã giao / đã lên lịch giao.`);
    return { ...line, id: old.id, deliveredQty: old.deliveredQty };
  });
  for (const old of unused) {
    if (old.deliveredQty > 0 || referenced.has(old.id))
      throw new Error(`Dòng "${old.name}" đã có phiếu đóng gói hoặc lịch giao. Hãy xử lý chứng từ liên quan trước khi xoá / đổi mã hàng.`);
  }
  return { updates, remove: [...unused] };
}

/** Cập nhật kỳ thu tại chỗ, giữ ID có phiếu thu; tổng phải thu luôn bằng giá trị mới. */
export function amendmentSchedules(existing: (ScheduleDraft & { id: string })[], next: ScheduleDraft[], paidIds: Set<string>) {
  const unused = new Set(existing);
  const updates = next.map(plan => {
    const old = [...unused].find(s => s.kind === plan.kind);
    if (old) unused.delete(old);
    return { ...plan, id: old?.id || null };
  });
  const remove: string[] = [];
  for (const old of unused) {
    if (paidIds.has(old.id)) updates.push({ ...old, amount: 0 });
    else remove.push(old.id);
  }
  return { updates, remove };
}
