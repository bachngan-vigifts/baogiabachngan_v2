import { AppError } from "../../../core/errors.ts";
import { documentDate } from "../../../core/document-number.ts";

export type SepayPayment = {
  providerId: string;
  amount: number;
  accountNumber: string;
  transactionAt: string;
  transferType: "in";
  content: string;
  payload: string;
};

const str = (v: unknown, max: number): string => {
  const value =
    typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (value.length > max)
    throw new AppError(400, "Trường giao dịch SePay quá dài.");
  return value;
};
export const normalizeSepayReference = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** Whole references only: a bank may remove separators, but must not turn DH10 into DH1. */
export function sepayReferenceCandidates(content: string): string[] {
  const words = content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/ +/)
    .filter(Boolean);
  if (words.length > 64) return []; // Bound work; complex statements remain available for reconciliation.
  const candidates = new Set<string>();
  for (let start = 0; start < words.length; start++) {
    let reference = "";
    for (let end = start; end < Math.min(words.length, start + 16); end++) {
      reference += words[end]!;
      if (reference.length > 200) break;
      if (/\d$/.test(reference) && /^\d/.test(words[end + 1] || "")) continue;
      candidates.add(reference);
    }
  }
  return [...candidates];
}

export function sepayPaidDate(transactionAt: string): string {
  return new Date(Date.parse(transactionAt) + 7 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function parseSepayPayment(body: Record<string, unknown>): SepayPayment {
  const transferType = str(
    body.transferType ?? body.transfer_type,
    20,
  ).toLowerCase();
  const rawAmount = body.transferAmount ?? body.transfer_amount ?? body.amount;
  const amount =
    typeof rawAmount === "number" ||
    (typeof rawAmount === "string" && /^\d+(?:\.0+)?$/.test(rawAmount.trim()))
      ? Number(rawAmount)
      : NaN;
  const providerId = str(
    body.id ?? body.transactionId ?? body.transaction_id ?? body.referenceCode,
    200,
  );
  const accountNumber = str(
    body.accountNumber ?? body.account_number,
    100,
  ).replace(/\s+/g, "");
  const content = str(body.content ?? body.description, 2000);
  const rawAt = str(
    body.transactionDate ??
      body.transaction_date ??
      body.transactionTime ??
      body.transaction_time,
    100,
  );
  if (
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      rawAt,
    )
  )
    throw new AppError(400, "Thiếu hoặc sai thời điểm giao dịch SePay.");
  if (
    Number(rawAt.slice(11, 13)) > 23 ||
    Number(rawAt.slice(14, 16)) > 59 ||
    Number(rawAt.slice(17, 19)) > 59
  )
    throw new AppError(400, "Giờ giao dịch SePay không hợp lệ.");
  try {
    documentDate(rawAt.slice(0, 10));
  } catch {
    throw new AppError(400, "Ngày giao dịch SePay không hợp lệ.");
  }
  const parsedAt = new Date(
    rawAt.replace(" ", "T") +
      (/(?:Z|[+-]\d{2}:\d{2})$/.test(rawAt) ? "" : "+07:00"),
  );
  if (
    transferType !== "in" ||
    !providerId ||
    !/^[A-Za-z0-9]+$/.test(accountNumber) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 1_000_000_000_000 ||
    !content ||
    Number.isNaN(parsedAt.valueOf()) ||
    parsedAt.valueOf() > Date.now() + 5 * 60_000
  )
    throw new AppError(400, "Giao dịch SePay không hợp lệ.");
  const payload = JSON.stringify(body);
  if (new TextEncoder().encode(payload).length > 32_000)
    throw new AppError(413, "Gói SePay quá lớn.");
  return {
    providerId,
    amount,
    accountNumber,
    transactionAt: parsedAt.toISOString(),
    transferType: "in",
    content,
    payload,
  };
}

export function decideSepayMatch(
  matches: { id: string; outstanding: number }[],
  amount: number,
) {
  if (!matches.length)
    return {
      status: "unmatched" as const,
      reason:
        "Không tìm thấy mã đơn, báo giá hoặc hợp đồng trong nội dung chuyển khoản.",
    };
  if (matches.length > 1)
    return {
      status: "review" as const,
      reason: "Nội dung chuyển khoản khớp nhiều đơn; cần kế toán đối soát.",
    };
  const order = matches[0]!;
  if (order.outstanding <= 0)
    return {
      status: "review" as const,
      reason: "Đơn đã thu đủ; không tự động ghi nhận thêm.",
      orderId: order.id,
    };
  if (amount > order.outstanding)
    return {
      status: "review" as const,
      reason: "Số tiền chuyển vượt công nợ còn lại.",
      orderId: order.id,
    };
  return { status: "matched" as const, reason: "", orderId: order.id };
}
