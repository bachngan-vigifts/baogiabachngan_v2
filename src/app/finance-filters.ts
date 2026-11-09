import { AppError } from "../core/errors.ts";

export function financeFilters(p: URLSearchParams): {
  from: string;
  to: string;
  branch: string;
} {
  const from = p.get("from") || "",
    to = p.get("to") || "",
    branch = (p.get("branch") || "").trim();
  const day = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  if (
    !day(from) ||
    !day(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 366 * 86400000
  )
    throw new AppError(400, "Chọn khoảng ngày hợp lệ, tối đa 366 ngày.");
  if (branch.length > 100) throw new AppError(400, "Chi nhánh không hợp lệ.");
  return { from, to, branch };
}
