import type { AnyDb } from '../db/client.ts';

/** Điểm báo cáo tuần của một người trong tháng (Sale / Sale Admin) – căn cứ Tiền trách nhiệm. */
export interface WeeklyReportPoints {
  points: number; required: number;
  weeks: { period: string; deadline: string; state: string; review: string | null; score: number | null }[];
}
/**
 * App lắp từ module staff-reports: chỉ trả người phải nộp báo cáo tuần (chức vụ Sale / Sale Admin) và tháng đã áp dụng.
 * Người không có trong Map → bảng lương tính Tiền trách nhiệm như cũ.
 */
export type WeeklyReportPointsOf = (db: AnyDb, month: string, memberIds: readonly string[]) => Promise<Map<string, WeeklyReportPoints>>;
/** Chỉ tiêu doanh số tháng đã đăng ký (bảng Đăng ký doanh số năm) – null = chưa có. App lắp từ HR. */
export type SaleTargetOf = (db: AnyDb, memberId: string, month: string) => Promise<number | null>;
