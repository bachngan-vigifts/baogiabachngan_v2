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

/**
 * Keep connected document components atomic, including spaces around separators.
 * Only whitespace between whole tokens may be normalized by joining tokens; never
 * emit DH1 from DH1-ABC, PREFIX/DH1, or DH1 / ABC.
 */
export function sepayReferenceCandidates(content: string): string[] {
  const words = content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/([A-Z0-9])(?:\s*[-_/.‐‑‒–—−])+\s*(?=[A-Z0-9])/g, "$1")
    .trim()
    .split(/\s+/)
    .map(normalizeSepayReference)
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

/** Invoice numbers may be numeric: require an invoice label, never match a transfer amount. */
export function sepayInvoiceCandidates(content:string):string[] {
 const text=content.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'D').toUpperCase()
   .replace(/([A-Z0-9])(?:\s*[-_/.‐‑‒–—−])+\s*(?=[A-Z0-9])/g,'$1');
 return [...new Set([...text.matchAll(/\b(?:HOA\s*DON|INVOICE|HD)(?:\s+SO)?(?:\s*[:#]\s*|\s+)([A-Z0-9]+(?:\s*(?:[,;&]|\bVA\b)\s*[A-Z0-9]+)*)/g)]
   .filter(m=>!/^[A-Z0-9]|^\s+\d/.test(text.slice(m.index!+m[0].length)))
   .flatMap(m=>m[1]!.split(/\s*(?:[,;&]|\bVA\b)\s*/).map(normalizeSepayReference)))];
}

export function sepayPaidDate(transactionAt: string): string {
  return new Date(Date.parse(transactionAt) + 7 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

export type SepayBankTransaction = Omit<SepayPayment,'transferType'> & {transferType:'in'|'out'};
export function parseSepayBankTransaction(body: Record<string, unknown>): SepayBankTransaction {
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
    !["in","out"].includes(transferType) ||
    !providerId ||
    !/^[A-Za-z0-9]+$/.test(accountNumber) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 1_000_000_000_000 ||
    (transferType==="in"&&!content) ||
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
    transferType: transferType as "in"|"out",
    content,
    payload,
  };
}

export function decideSepayMatch(
  matches: { id: string; outstanding: number }[],
  amount: number,
  exactAmount = false,
) {
  if (!matches.length)
    return {
      status: "unmatched" as const,
      reason:
        "Không tìm thấy mã đơn, báo giá, hợp đồng hoặc hóa đơn trong nội dung chuyển khoản.",
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
  if(exactAmount && amount !== order.outstanding)return {status:"review" as const,reason:"Số tiền chuyển chưa khớp công nợ còn lại; cần đối soát.",orderId:order.id};
  return { status: "matched" as const, reason: "", orderId: order.id };
}

/** Receipt/matching entrypoints must remain incoming-only. */
export function parseSepayPayment(body:Record<string,unknown>):SepayPayment{
 const row=parseSepayBankTransaction(body);
 if(row.transferType!=='in')throw new AppError(400,'Giao dịch SePay không hợp lệ.');
 return {...row,transferType:'in'};
}
