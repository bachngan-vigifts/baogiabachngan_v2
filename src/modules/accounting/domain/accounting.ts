import { AppError } from "../../../core/errors.ts";
export const canUseAccounting = (m: {
  role: string;
  positionId?: string | null;
}) =>
  m.role === "manager" ||
  (m.role === "employee" && m.positionId === "accounting");
export const day = (s: unknown) => {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    s < "2000-01-01" ||
    !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new AppError(400, "Ngày không hợp lệ (YYYY-MM-DD).");
  return s;
};
export const taxCode = (s: unknown) => {
  const t = String(s || "")
    .trim()
    .replace(/-/g, "");
  if (!/^\d{10}(\d{3})?$/.test(t))
    throw new AppError(400, "MST phải gồm 10 hoặc 13 chữ số.");
  return t;
};
export const short = (v: unknown, max = 300) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new AppError(400, "Nội dung bắt buộc, tối đa " + max + " ký tự.");
  return v.trim();
};
export const qty = (n: number) => Math.round(n * 1000) / 1000;
export type Kind =
  | "opening"
  | "purchase"
  | "sale"
  | "purchase_return"
  | "sale_return";
export interface Line {
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  netValue: number;
  taxRate: number | null;
  carryingValue?: number | null;
  sourceLineId?: string | null;
}
export interface Document {
  id: string;
  bookId: string;
  kind: Kind;
  state: string;
  date: string;
  reference: string;
  createdAt: string;
  relatedId?: string | null;
  lines: Line[];
}
export function validateLines(raw: unknown): Line[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 300)
    throw new AppError(400, "Chứng từ cần 1–300 dòng.");
  const seen = new Set<string>();
  return raw.map((l: any) => {
    const quantity = Number(l.quantity),
      netValue = Number(l.netValue),
      rate =
        l.taxRate === null || l.taxRate === undefined || l.taxRate === ""
          ? null
          : Number(l.taxRate);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1e9 ||
      Math.abs(quantity - qty(quantity)) > 1e-8 ||
      !Number.isSafeInteger(netValue) ||
      netValue < 0 ||
      netValue > 9e12 ||
      (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100))
    )
      throw new AppError(
        400,
        "Số lượng (tối đa 3 số lẻ), tiền trước VAT hoặc thuế suất không hợp lệ.",
      );
    const carry = l.carryingValue == null ? null : Number(l.carryingValue);
    if (
      carry !== null &&
      (!Number.isSafeInteger(carry) || carry < 0 || carry > 9e12)
    )
      throw new AppError(400, "Giá trị ghi sổ hàng trả không hợp lệ.");
    const row = {
      carryingValue: carry,
      sku: short(l.sku, 64),
      name: short(l.name, 500),
      unit: short(l.unit, 50),
      quantity,
      netValue,
      taxRate: rate,
    };
    const k = row.sku + "\0" + row.unit;
    if (seen.has(k))
      throw new AppError(400, "Gộp dòng trùng SKU/đơn vị tính trước khi lưu.");
    seen.add(k);
    return row;
  });
}
export interface Stock {
  bookId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  value: number;
  lastPurchase: string | null;
  lastSale: string | null;
  purchased: number;
  sold: number;
  saleValue: number;
  costSold: number;
  missingCost: boolean;
  documents: string[];
}
/** Management weighted average. It never reads/writes the physical stock ledger. */
export function ledger(documents: Document[], from: string, to: string) {
  const stock = new Map<string, Stock>();
  let openingValue = 0,
    purchases = 0,
    sales = 0,
    complete = true;
  const anomalies: {
    code: string;
    bookId: string;
    sku: string;
    documentId: string;
    message: string;
  }[] = [];
  for (const d of [...documents]
    .filter((d) => d.state === "posted" && d.date <= to)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.kind === "opening") - Number(a.kind === "opening") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )) {
    const inPeriod = d.date >= from;
    for (const l of d.lines) {
      const key = [d.bookId, l.sku, l.unit].join("\0");
      let s = stock.get(key);
      if (!s) {
        s = {
          bookId: d.bookId,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          quantity: 0,
          value: 0,
          lastPurchase: null,
          lastSale: null,
          purchased: 0,
          sold: 0,
          saleValue: 0,
          costSold: 0,
          missingCost: false,
          documents: [],
        };
        stock.set(key, s);
      }
      const incoming = ["opening", "purchase", "sale_return"].includes(d.kind),
        before = s.quantity,
        cost = before > 0 ? s.value / before : 0;
      let movementValue = ["sale_return", "purchase_return"].includes(d.kind)
        ? (l.carryingValue ?? 0)
        : l.netValue;
      if (d.kind === "sale") {
        if (before <= 0 || s.value <= 0) {
          s.missingCost = true;
          complete = false;
        }
        movementValue = Math.round(cost * l.quantity);
      }
      // Returns must supply the original carrying value, not a sales-price estimate.
      if (d.kind === "sale_return" || d.kind === "purchase_return") {
        if (!d.relatedId || l.carryingValue == null) {
          complete = false;
          anomalies.push({
            code: "return_source_missing",
            bookId: d.bookId,
            sku: l.sku,
            documentId: d.id,
            message:
              "Phiếu trả cần chứng từ gốc và giá trị ghi sổ đã đối soát.",
          });
        }
      }
      s.quantity = qty(s.quantity + (incoming ? l.quantity : -l.quantity));
      s.value = Math.round(
        s.value + (incoming ? movementValue : -movementValue),
      );
      if (d.date < from || d.kind === "opening")
        openingValue += incoming ? movementValue : -movementValue;
      if (inPeriod && d.kind === "purchase") purchases += l.netValue;
      if (inPeriod && d.kind === "purchase_return") purchases -= l.netValue;
      if (inPeriod && d.kind === "sale") sales += l.netValue;
      if (inPeriod && d.kind === "sale_return") sales -= l.netValue;
      if (d.kind === "purchase") s.lastPurchase = d.date;
      if (d.kind === "sale") s.lastSale = d.date;
      if (inPeriod) {
        if (d.kind === "purchase") s.purchased += l.quantity;
        if (d.kind === "purchase_return") s.purchased -= l.quantity;
        if (d.kind === "sale") {
          s.sold += l.quantity;
          s.saleValue += l.netValue;
          s.costSold += movementValue;
        }
        if (d.kind === "sale_return") {
          s.sold -= l.quantity;
          s.saleValue -= l.netValue;
          s.costSold -= movementValue;
        }
      }
      if (s.documents.length < 20 && !s.documents.includes(d.id))
        s.documents.push(d.id);
      if (s.quantity < 0 || s.value < 0) {
        complete = false;
        anomalies.push({
          code: "negative_stock",
          bookId: d.bookId,
          sku: l.sku,
          documentId: d.id,
          message: "Âm số lượng hoặc giá trị tại chứng từ " + d.reference,
        });
      }
      if (d.kind !== "opening" && l.taxRate === null)
        anomalies.push({
          code: "tax_unknown",
          bookId: d.bookId,
          sku: l.sku,
          documentId: d.id,
          message: "Chưa xác nhận thuế suất; không tự mặc định 8%.",
        });
    }
  }
  if (
    ![
      openingValue,
      purchases,
      sales,
      ...[...stock.values()].flatMap((s) => [s.value, s.saleValue, s.costSold]),
    ].every(Number.isSafeInteger)
  )
    throw new AppError(
      422,
      "Tổng tiền vượt phạm vi tính toán chính xác; cần chia nhỏ và đối soát.",
    );
  return {
    stock: [...stock.values()],
    openingValue,
    purchases,
    sales,
    complete,
    anomalies,
  };
}
export function periodMonths(from: string, to: string) {
  const first = day(from).slice(0, 7),
    last = day(to).slice(0, 7);
  if (from > to) throw new AppError(400, "Từ ngày phải trước đến ngày.");
  const months = [];
  for (let y = Number(first.slice(0, 4)), m = Number(first.slice(5)); ; ) {
    const month = y + "-" + String(m).padStart(2, "0");
    months.push(month);
    if (month === last) break;
    if (months.length >= 12) throw new AppError(400, "Chọn tối đa 12 tháng.");
    if (++m === 13) {
      m = 1;
      y++;
    }
  }
  return months;
}
export function kAssessment(
  facts: ReturnType<typeof ledger>,
  coverage: boolean,
  referenceK: number | null,
) {
  const denominator = facts.openingValue + facts.purchases;
  if (!coverage || !facts.complete || denominator <= 0)
    return {
      state: "unknown" as const,
      ratio: null,
      referenceK,
      message:
        "Chưa đủ dữ liệu tồn đầu kỳ/nhập/xuất và xác nhận đủ chứng từ của kỳ.",
    };
  const ratio = facts.sales / denominator;
  return {
    state:
      referenceK === null
        ? ("unconfigured" as const)
        : ratio > referenceK
          ? ("review" as const)
          : ("within_reference" as const),
    ratio,
    referenceK,
    message:
      "Đối chiếu quản trị theo MST, giá trị trước VAT. Không phải kết luận tuân thủ hoặc hệ số do cơ quan thuế xác nhận.",
  };
}
