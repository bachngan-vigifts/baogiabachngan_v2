import { AppError } from "../../../core/errors.ts";
import { documentDate } from "../../../core/document-number.ts";

export const SEPAY_MATCH_MINUTES = 5;
export const SEPAY_MATCH_LIMIT = 50;
export const sepayWindow = (at: string) => {
  const time = Date.parse(at);
  if (!Number.isFinite(time))
    throw new AppError(400, "Thời điểm SePay không hợp lệ.");
  const span = SEPAY_MATCH_MINUTES * 60_000;
  return {
    from: new Date(time - span).toISOString(),
    to: new Date(time + span).toISOString(),
  };
};
export function chooseNearbySepay<T extends { amount: number; at: string }>(
  rows: T[],
  amount: number,
  at: string,
  now: string,
  overflow = false,
) {
  const window = sepayWindow(at);
  const matches = rows.filter(
    (row) =>
      Number.isSafeInteger(row.amount) &&
      row.amount === amount &&
      Date.parse(row.at) >= Date.parse(window.from) &&
      Date.parse(row.at) <= Date.parse(window.to),
  );
  if (overflow || matches.length > 1)
    return {
      status: "review" as const,
      reason:
        "Có nhiều đơn/phiếu thu cùng khớp số tiền trong ±5 phút; Manager cần chọn thủ công.",
    };
  if (Date.parse(now) < Date.parse(window.to))
    return {
      status: "review" as const,
      reason:
        "Chờ hết cửa sổ 5 phút sau giao dịch để đối chiếu cả đơn tạo sau; chưa ghi nhận tiền.",
    };
  if (!matches.length)
    return {
      status: "unmatched" as const,
      reason:
        "Không có đơn POS/web khớp chính xác số tiền trong ±5 phút. Chọn đơn/HĐKT để đối soát thủ công.",
    };
  return {
    status: "matched" as const,
    target: matches[0]!,
    reason: "Khớp duy nhất số tiền và thời điểm trong ±5 phút.",
  };
}
/** Woo GMT has no suffix; local Woo timestamps are Vietnam time, never the Edge server timezone. */
export function webOrderCreatedAt(
  gmt: unknown,
  local: unknown,
  fallback: string,
): string {
  const raw =
    typeof gmt === "string" && gmt.trim()
      ? gmt.trim()
      : typeof local === "string" && local.trim()
        ? local.trim()
        : "";
  if (!raw) return fallback;
  if (
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      raw,
    )
  )
    throw new AppError(400, "Ngày tạo đơn web không hợp lệ.");
  documentDate(raw.slice(0, 10));
  if (
    Number(raw.slice(11, 13)) > 23 ||
    Number(raw.slice(14, 16)) > 59 ||
    Number(raw.slice(17, 19)) > 59
  )
    throw new AppError(400, "Giờ tạo đơn web không hợp lệ.");
  const normalized =
    raw.replace(" ", "T") +
    (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
      ? ""
      : typeof gmt === "string" && gmt.trim()
        ? "Z"
        : "+07:00");
  const time = Date.parse(normalized);
  if (!Number.isFinite(time))
    throw new AppError(400, "Ngày tạo đơn web không hợp lệ.");
  return new Date(time).toISOString();
}
export const isBankWebMethod = (method: string) => {
  const value = method
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
  return (
    !/\bcod\b|nhan hang|tien mat/.test(value) &&
    /\bqr\b|sepay|bacs|bank|chuyen khoan|transfer/.test(value)
  );
};
