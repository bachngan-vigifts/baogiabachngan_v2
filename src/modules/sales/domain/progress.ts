import { PROGRESS_STAGES } from './statuses.ts';

/**
 * TIẾN TRÌNH SẢN PHẨM của đơn / HĐKT – hàm thuần. Mỗi bước tự xong theo chứng từ / công việc, hoặc Manager bấm xong nhanh:
 *  - Duyệt:      đơn / HĐKT đã được Manager duyệt (không còn nháp);
 *  - Xuất kho:   kho xác nhận phiếu đóng gói, hoặc POS tại quầy đã giao và có xuất trực tiếp đủ từng mã;
 *  - In mẫu:     (chỉ đơn có phí in) việc "In mẫu" được hoàn thành;
 *  - Sản xuất:   (chỉ đơn có phí in) việc "Sản xuất" được hoàn thành;
 *  - Giao hàng:  đơn đã giao đủ.
 * Bước hiện tại = bước đầu tiên chưa xong.
 */
export type ProgressStage = typeof PROGRESS_STAGES[number];
export type MarkSource = 'task' | 'manual';
export interface ProgressMark { source: MarkSource; at: string; byName?: string | null }

const STEP: Record<ProgressStage, { label: string; doing: string }> = {
  approve: { label: 'Duyệt', doing: 'Đợi duyệt' },
  export: { label: 'Xuất kho', doing: 'Chờ xuất kho' },
  sample: { label: 'In mẫu', doing: 'Đang in mẫu' },
  production: { label: 'Sản xuất', doing: 'Đang sản xuất' },
  delivered: { label: 'Giao hàng', doing: 'Đang giao hàng' },
};

/** Các bước áp dụng cho đơn: đơn không có phí in thì bỏ In mẫu / Sản xuất. */
export const stagesFor = (printing: boolean): ProgressStage[] => PROGRESS_STAGES.filter(s => printing || (s !== 'sample' && s !== 'production'));

export function orderProgress(i: { status: string; packed: boolean; directExported?: boolean; physicalExportRequired?: boolean; printing: boolean; marks: Partial<Record<ProgressStage, ProgressMark>> }) {
  const auto: Partial<Record<ProgressStage, boolean>> = {
    approve: i.status !== 'draft' && i.status !== 'cancelled',
    export: i.packed || i.directExported,
    delivered: i.status === 'delivered',
  };
  const stages = stagesFor(i.printing).map(key => {
    const mark = (key==='export'||key==='approve')&&i.physicalExportRequired?null:i.marks[key] ?? null, byDoc = !!auto[key];
    return { key, label: STEP[key].label, done: byDoc || !!mark, by: byDoc ? 'auto' as const : mark?.source ?? null, at: byDoc ? null : mark?.at ?? null, byName: byDoc ? null : mark?.byName ?? null };
  });
  const current = i.status === 'cancelled' ? null : stages.find(s => !s.done)?.key ?? null;
  const label = i.status === 'cancelled' ? 'Đã huỷ' : current ? STEP[current].doing : 'Đã giao hàng';
  return { physicalExportRequired:!!i.physicalExportRequired, stages, current, label, printing: i.printing, done: !current && i.status !== 'cancelled' };
}
export type OrderProgress = ReturnType<typeof orderProgress>;

/** Bấm "xong đến bước X": X và mọi bước áp dụng đứng trước X (chưa xong) – lối tắt của Manager. */
export function stagesUpTo(printing: boolean, stage: ProgressStage | 'all'): ProgressStage[] {
  const list = stagesFor(printing);
  return stage === 'all' ? list : list.slice(0, list.indexOf(stage) + 1);
}
