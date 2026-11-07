import { AppError } from "../../../core/errors.ts";

export interface ShiftReportFilters {
  from: string;
  to: string;
  registerId: string;
  memberId: string;
  templateId: string;
  q: string;
  status: string;
  difference: string;
  groupBy: string;
  page: number;
  pageSize: number;
}
export interface ShiftReportSummary {
  shiftCount: number;
  openCount: number;
  closedCount: number;
  differenceCount: number;
  shortage: number;
  surplus: number;
  billCount: number;
  revenue: number;
  discount: number;
  returnCredit: number;
  cash: number;
  transfer: number;
  manualIn: number;
  manualOut: number;
  refundCash: number;
  refundTransfer: number;
}
export interface ShiftReportRow {
  id: string;
  business_date: string;
  register_id: string;
  member_id: string;
  register_name: string;
  member_name: string;
  template_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  counted_cash: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  difference_reason: string;
  billCount: number;
  revenue: number;
  discount: number;
  returnCredit: number;
  cash: number;
  transfer: number;
  manualIn: number;
  manualOut: number;
  refundCash: number;
  refundTransfer: number;
}
export interface ShiftReportsPage {
  summary: ShiftReportSummary;
  rows: ShiftReportRow[];
  groups: (ShiftReportSummary & { id: string; name: string })[];
  registers: { id: string; name: string }[];
  members: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  filters: ShiftReportFilters;
  asOf: string;
  scope: "all" | "own";
}

export function shiftReportFilters(
  params: URLSearchParams,
  today: string,
): ShiftReportFilters {
  const from = params.get("from") || today.slice(0, 7) + "-01";
  const to = params.get("to") || today;
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 1096 * 86400000
  )
    throw new AppError(400, "Chọn khoảng ngày hợp lệ, tối đa 3 năm.");
  const choice = (key: string, allowed: string[], fallback: string) => {
    const value = params.get(key) || fallback;
    if (!allowed.includes(value))
      throw new AppError(400, "Bộ lọc báo cáo không hợp lệ.");
    return value;
  };
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new AppError(400, "Phân trang không hợp lệ.");
    return value;
  };
  const text = (key: string) => {
    const value = (params.get(key) || "").trim();
    if (value.length > 100) throw new AppError(400, "Bộ lọc quá dài.");
    return value;
  };
  return {
    from,
    to,
    registerId: text("registerId"),
    memberId: text("memberId"),
    templateId: text("templateId"),
    q: text("q"),
    status: choice("status", ["all", "open", "closed"], "all"),
    difference: choice(
      "difference",
      ["all", "matched", "shortage", "surplus"],
      "all",
    ),
    groupBy: choice("groupBy", ["register", "member", "day"], "register"),
    page: integer("page", 1, 100000),
    pageSize: integer("pageSize", 25, 100),
  };
}
