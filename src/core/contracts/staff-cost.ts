import type { AnyDb } from '../db/client.ts';

/**
 * Chi phí nhân sự một tháng theo người – lấy từ BẢNG LƯƠNG (phiếu đã chốt = bản chụp lúc chốt; chưa chốt = tạm tính).
 * `gross` = tổng thu nhập trên phiếu (không gồm khấu trừ: tạm ứng / BHXH người lao động / vi phạm không phải chi phí mới).
 * `bonus` = các dòng thưởng (KPI DS, HĐKT + điều chỉnh, sản lượng, quý, DS cửa hàng, khác); `salary` = gross − bonus (lương + phụ cấp).
 * App lắp từ HR; mô-đun lợi nhuận không import HR.
 */
export interface StaffCost {
  memberId: string; name: string; positionId: string | null; payrollGroup: string;
  status: 'estimate' | 'confirmed' | 'paid'; gross: number; bonus: number; salary: number;
}
export type StaffCostOf = (db: AnyDb, month: string) => Promise<StaffCost[]>;
