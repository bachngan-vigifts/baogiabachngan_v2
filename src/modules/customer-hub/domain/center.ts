import { AppError } from "../../../core/errors.ts";
import { isCalendarDate } from "../../customers/domain/anniversary.ts";

export function centerWindow(month: string, today: string, days = 180) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 1901 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3650
  )
    throw new AppError(400, "Chọn tháng hợp lệ và số ngày từ 1 đến 3650.");
  const year = Number(month.slice(0, 4)) - 1,
    m = Number(month.slice(5));
  return {
    month,
    days,
    today,
    from: `${year}-${month.slice(5)}-01`,
    to:
      m === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(m + 1).padStart(2, "0")}-01`,
    cutoff: new Date(Date.parse(today + "T00:00:00Z") - days * 864e5)
      .toISOString()
      .slice(0, 10),
  };
}
export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "completed",
  "cancelled",
] as const;
export function campaignInput(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim(),
    note = String(body.note ?? "").trim(),
    startDate = String(body.startDate ?? ""),
    endDate = String(body.endDate ?? "");
  const status = body.status ?? "active";
  if (
    !name ||
    name.length > 160 ||
    note.length > 2000 ||
    !isCalendarDate(startDate) ||
    !isCalendarDate(endDate) ||
    startDate > endDate ||
    !CAMPAIGN_STATUSES.includes(status as (typeof CAMPAIGN_STATUSES)[number])
  )
    throw new AppError(
      400,
      "Nhập tên (tối đa 160 ký tự), ngày bắt đầu/kết thúc và trạng thái hợp lệ.",
    );
  return {
    name,
    note,
    startDate,
    endDate,
    status: status as (typeof CAMPAIGN_STATUSES)[number],
  };
}
