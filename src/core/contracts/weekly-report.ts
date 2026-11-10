import type { AnyDb } from '../db/client.ts';

export interface ReportPeriodScore {
  /** Giờ nộp đầu tiên; có thể thiếu trong bản chụp lương cũ. */
  submittedAt?: string | null;
  period: string; deadline: string; state: string; review: string | null; score: number | null;
}
/** Điểm báo cáo của một người trong tháng – giữ weeks cho bản chụp cũ, thêm monthly cho chính sách mới. */
export interface WeeklyReportPoints {
  points: number; required: number;
  weeks: ReportPeriodScore[];
  monthly?: ReportPeriodScore | null;
}
/**
 * App lắp từ module staff-reports: chỉ trả người phải nộp báo cáo tuần (chức vụ Sale / Sale Admin) và tháng đã áp dụng.
 * Người không có trong Map → bảng lương tính Tiền trách nhiệm như cũ.
 */
export type WeeklyReportPointsOf = (db: AnyDb, month: string, memberIds: readonly string[]) => Promise<Map<string, WeeklyReportPoints>>;
/** Chỉ tiêu doanh số tháng đã đăng ký (bảng Đăng ký doanh số năm) – null = chưa có. App lắp từ HR. */
export type SaleTargetOf = (db: AnyDb, memberId: string, month: string) => Promise<number | null>;

/** Thưởng KPI DS dự kiến của một Sale trong tháng – đúng như bảng lương đang tính (cho báo cáo tháng). */
export interface SalePayrollPreview {
  /** KPI CV: từng chỉ số thực hiện / chỉ tiêu; `used` = KPI CV dùng xét thưởng (null = không áp dụng KPI). */
  kpi: { used: number | null; rows: { key: 'newCustomers' | 'transactions' | 'contracts' | 'revenue'; actual: number | null; target: number }[] } | null;
  /** `applied` = phiếu lương đang tính thưởng này; false = chỉ tạm tính để tham khảo. */
  bonus: { rate: number; amount: number; basis: number; basisLabel: string; applied: boolean; tiers: { from: number; rate: number }[] };
}
/** App lắp từ HR (buildPayroll); null = người không thuộc bảng lương Sale. */
export type SalePayrollPreviewOf = (db: AnyDb, memberId: string, month: string) => Promise<SalePayrollPreview | null>;
