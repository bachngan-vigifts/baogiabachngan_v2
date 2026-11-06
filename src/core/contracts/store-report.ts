import type { AnyDb } from '../db/client.ts';

/**
 * Chỉ tiêu và kết quả doanh số cửa hàng cho báo cáo CHT – lấy CÙNG nguồn / chính sách đang dùng xét thưởng DS cửa hàng
 * (cấu hình nguồn doanh số cửa hàng + tham số lương của tháng). Không có dữ liệu lương cá nhân.
 */
export type StoreTargetFacts =
  | { configured: false; reason: string }
  | {
    configured: true;
    /** Tháng bắt đầu áp dụng cấu hình nguồn. */
    policyMonth: string;
    target: number;
    /** Doanh số xét chỉ tiêu = CRM net (đơn đã duyệt, trước VAT trừ hoa hồng) + POS trước VAT (đơn đã duyệt) của cửa hàng. */
    revenue: number; crm: number; pos: number;
    /** Số đơn chưa đối chiếu được (doanh số có thể còn thay đổi). */
    issues: number;
    ratio: number;
    /** Tỷ lệ thưởng DS cửa hàng đang đạt và các mốc (`strict` = phải vượt). */
    rate: number; tiers: { at: number; rate: number; strict: boolean }[];
    /** Thưởng DS chung cửa hàng TẠM TÍNH (trước khi chia người) – số chốt theo phiếu lương. */
    bonusEstimate: number;
  };
export type StoreTargetOf = (db: AnyDb, registerId: string, month: string) => Promise<StoreTargetFacts>;
/** Công chấm HR của nhân viên trong tháng (đối chiếu với ngày có ca POS). `recorded` = số ngày đã chấm. */
export type StoreAttendanceOf = (db: AnyDb, memberIds: readonly string[], month: string) => Promise<Map<string, { worked: number; recorded: number }>>;
