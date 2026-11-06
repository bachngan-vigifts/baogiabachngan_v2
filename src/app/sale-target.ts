import type { SaleTargetOf } from '../core/contracts/weekly-report.ts';
import { revenueTargetsFor, targetKey } from '../modules/hr/api/revenue-target-data.ts';

/** Chỉ tiêu doanh số tháng đã duyệt ở bảng Đăng ký doanh số năm (null = chưa đăng ký) – cho báo cáo tuần Sale. */
export const saleTargetOf: SaleTargetOf = async (db, memberId, month) =>
  (await revenueTargetsFor(db, [month], [memberId])).get(targetKey(memberId, month)) ?? null;
