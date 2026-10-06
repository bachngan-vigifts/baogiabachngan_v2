/**
 * Cấu hình bảng Công việc (một chỗ duy nhất để sửa): trạng thái, mức ưu tiên, nguồn việc.
 * Thêm nguồn mới = thêm một dòng ở TASK_SOURCES (+ một quy tắc ở api/auto-tasks.ts nếu là việc tự sinh).
 * Giao diện (trial-ui/tasks.js) dùng cùng khoá; nhãn / màu ở đây là chuẩn.
 */
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TASK_SOURCES = ['manual', 'quote', 'stock_request', 'order', 'delivery', 'contract', 'receivable', 'purchase'] as const;

export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];
export type TaskSource = typeof TASK_SOURCES[number];

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'Cần làm', in_progress: 'Đang làm', done: 'Hoàn thành', cancelled: 'Đã huỷ' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn' };
export const SOURCE_LABEL: Record<TaskSource, string> = {
  manual: 'Giao việc', quote: 'Báo giá', stock_request: 'Check tồn', order: 'Đơn hàng', delivery: 'Giao hàng', contract: 'HĐKT', receivable: 'Công nợ', purchase: 'Nhập hàng',
};

export const OPEN_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress'];
export const isOpen = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);
/** Thứ tự sắp xếp: khẩn trước. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Ngày (YYYY-MM-DD) cộng thêm n ngày. */
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** Phân loại hạn: quá hạn / hôm nay / sắp tới / chưa có hạn. */
export function dueBucket(dueDate: string | null, today: string): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!dueDate) return 'none';
  return dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'upcoming';
}
