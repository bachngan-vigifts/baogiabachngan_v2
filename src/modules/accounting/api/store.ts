import { and, eq, inArray, lte, asc, sql } from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import type { AnyDb } from "../../../core/db/client.ts";
import {
  accountingBooks as books,
  accountingDocuments as docs,
  accountingLines as lines,
  accountingEntities as entities,
  accountingPeriods as periods,
  accountingReviews as reviews,
} from "../schema.ts";
import {
  ledger,
  kAssessment,
  periodMonths,
  type Document,
} from "../domain/accounting.ts";
import { sha256Hex } from "../../staff/domain/session.ts";
export type Db = AnyDb;
export async function bookOf(db: Db, id: string) {
  const [b] = await db.select().from(books).where(eq(books.id, id)).limit(1);
  if (!b) throw new AppError(404, "Không tìm thấy sổ kho kế toán.");
  return b;
}
export async function documentsOf(db: Db, bookIds: string[], to: string) {
  if (!bookIds.length) return [];
  const headers = await db
    .select()
    .from(docs)
    .where(and(inArray(docs.bookId, bookIds), lte(docs.date, to)))
    .orderBy(asc(docs.date), asc(docs.createdAt), asc(docs.id))
    .limit(2001);
  if (headers.length > 2000)
    throw new AppError(
      413,
      "Phạm vi vượt 2.000 chứng từ. Cần đối soát/chia sổ trước khi phân tích, không tính trên dữ liệu bị cắt.",
    );
  const rows = headers.length
    ? await db
        .select()
        .from(lines)
        .where(
          inArray(
            lines.documentId,
            headers.map((h) => h.id),
          ),
        )
        .limit(10001)
    : [];
  if (rows.length > 10000)
    throw new AppError(
      413,
      "Phạm vi vượt 10.000 dòng. Chưa thể tính chính xác trong lượt này.",
    );
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = grouped.get(row.documentId) || [];
    group.push(row);
    grouped.set(row.documentId, group);
  }
  return headers.map((h) => ({
    ...h,
    lines: (grouped.get(h.id) || [])
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        taxRate: l.taxRate === null ? null : Number(l.taxRate),
      })),
  }));
}
export async function entityLock(db: Db, id: string) {
  const [e] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .for("update");
  if (!e) throw new AppError(404, "Không tìm thấy pháp nhân.");
  return e;
}
export async function invalidateCoverage(
  db: Db,
  entityId: string,
  date: string,
) {
  await db
    .delete(periods)
    .where(
      and(
        eq(periods.entityId, entityId),
        sql`${periods.month} >= ${date.slice(0, 7)}`,
      ),
    );
}
export interface Alert {
  fingerprint: string;
  code: string;
  severity: "review" | "critical";
  bookId?: string;
  sku?: string;
  documentId?: string;
  message: string;
  value?: number;
  source: string;
  review?: unknown;
}
export async function snapshot(
  db: Db,
  entityId: string,
  from: string,
  to: string,
  onlyBook?: string,
) {
  const months = periodMonths(from, to),
    [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
  if (!entity) throw new AppError(404, "Không tìm thấy pháp nhân.");
  const allBooks = await db
    .select()
    .from(books)
    .where(eq(books.entityId, entityId))
    .orderBy(asc(books.id));
  if (onlyBook && !allBooks.some((b) => b.id === onlyBook))
    throw new AppError(404, "Kho không thuộc pháp nhân đang chọn.");
  const documents = await documentsOf(
      db,
      allBooks.map((b) => b.id),
      to,
    ),
    allFacts = ledger(documents as Document[], from, to),
    facts = onlyBook
      ? ledger(
          documents.filter((d) => d.bookId === onlyBook) as Document[],
          from,
          to,
        )
      : allFacts;
  const verified = await db
    .select()
    .from(periods)
    .where(and(eq(periods.entityId, entityId), inArray(periods.month, months)))
    .orderBy(asc(periods.month));
  const opened =
    allBooks.length > 0 &&
    allBooks.every((b) => b.openingDate !== null && b.openingDate <= from);
  const k = kAssessment(
    allFacts,
    opened && months.every((m) => verified.some((v) => v.month === m)),
    entity.referenceK === null ? null : Number(entity.referenceK),
  );
  const version = sha256Hex(
    JSON.stringify([
      documents
        .filter((d) => d.state !== "draft")
        .map((d) => [d.id, d.revision, d.state]),
      entity.revision,
      allBooks.map((b) => [b.id, b.revision, b.openingDate]),
      verified.map((v) => [v.month, v.verifiedAt]),
      from,
      to,
    ]),
  );
  const alerts: Alert[] = [],
    push = (a: Omit<Alert, "fingerprint">) =>
      alerts.push({
        ...a,
        fingerprint: sha256Hex(JSON.stringify([version, a])),
      });
  for (const anomaly of facts.anomalies)
    push({
      ...anomaly,
      severity: anomaly.code === "negative_stock" ? "critical" : "review",
      source: "Chứng từ trong sổ kế toán",
    });
  for (const b of allBooks.filter((b) => !onlyBook || b.id === onlyBook))
    if (!b.openingDate)
      push({
        code: "opening_missing",
        severity: "critical",
        bookId: b.id,
        message: "Chưa duyệt số dư đầu kỳ. Không suy ra tồn bằng 0.",
        source: "Thiết lập sổ",
      });
  const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 864e5 + 1);
  const firstDates = new Map<string, string>();
  for (const d of documents)
    if (d.state === "posted")
      for (const l of d.lines) {
        const key = [d.bookId, l.sku, l.unit].join("\0");
        if (!firstDates.has(key) || d.date < firstDates.get(key)!)
          firstDates.set(key, d.date);
      }
  for (const s of facts.stock) {
    const first = firstDates.get([s.bookId, s.sku, s.unit].join("\0"));
    const since = s.lastSale || s.lastPurchase || first;
    const age = since
      ? Math.floor((Date.parse(to) - Date.parse(since)) / 864e5)
      : null;
    if (s.quantity > 0 && age !== null && age >= entity.slowDays)
      push({
        code: "slow_stock",
        severity: "review",
        bookId: s.bookId,
        sku: s.sku,
        value: s.value,
        message:
          age === null
            ? "Có tồn nhưng chưa có lượt xuất bán trong dữ liệu sổ."
            : "Không bán trong " + age + " ngày.",
        source: "Ngưỡng quản trị " + entity.slowDays + " ngày",
      });
    if (
      s.quantity > 0 &&
      s.sold > 0 &&
      s.quantity / (s.sold / days) > entity.coverageDays
    )
      push({
        code: "high_stock",
        severity: "review",
        bookId: s.bookId,
        sku: s.sku,
        value: Math.round(s.quantity / (s.sold / days)),
        message: "Số ngày tồn dự kiến vượt ngưỡng quản trị.",
        source:
          "Tồn cuối / xuất bán ròng bình quân ngày; ngưỡng " +
          entity.coverageDays,
      });
    if (
      s.purchased > 0 &&
      (s.sold <= 0 || s.purchased / s.sold > Number(entity.importRatio))
    )
      push({
        code: "import_imbalance",
        severity: "review",
        bookId: s.bookId,
        sku: s.sku,
        message:
          "Nhập nhiều so với xuất bán trong kỳ; cần kiểm tra mùa vụ và kế hoạch mua.",
        source: "Cùng SKU, đơn vị, kỳ; ngưỡng quản trị " + entity.importRatio,
      });
    if (s.missingCost)
      push({
        code: "cost_unknown",
        severity: "critical",
        bookId: s.bookId,
        sku: s.sku,
        message: "Chưa đủ căn cứ giá trị ghi sổ để tính giá vốn.",
        source: "Bình quân liên hoàn của sổ kế toán",
      });
    if (s.sold > 0 && !s.missingCost && s.saleValue < s.costSold)
      push({
        code: "below_cost",
        severity: "review",
        bookId: s.bookId,
        sku: s.sku,
        value: s.saleValue - s.costSold,
        message: "Giá trị bán ròng dưới giá vốn bình quân của sổ.",
        source: "Chưa VAT; chưa gồm chi phí chung",
      });
  }
  if (k.state === "review")
    push({
      code: "k_reference",
      severity: "review",
      message:
        "Tỷ lệ nội bộ vượt tham số K tham chiếu; cần đối soát, không kết luận vi phạm.",
      value: k.ratio!,
      source: entity.kSource,
    });
  const states = alerts.length
    ? await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.entityId, entityId),
            inArray(
              reviews.fingerprint,
              alerts.map((a) => a.fingerprint),
            ),
          ),
        )
    : [];
  const reviewByFingerprint = new Map(states.map((r) => [r.fingerprint, r]));
  return {
    entity,
    books: allBooks,
    from,
    to,
    bookId: onlyBook || null,
    valuationMethod: "Bình quân liên hoàn, giá trị trước VAT; chỉ sổ kế toán",
    physicalInventoryAffected: false,
    k: {
      ...k,
      scope: "Toàn pháp nhân/MST, không thu hẹp theo bộ lọc kho",
      source: entity.kSource,
      verifiedDate: entity.kVerifiedDate,
    },
    coverage: { opened, months, confirmed: verified.map((v) => v.month) },
    stock: facts.stock,
    totals: {
      stockValue: opened ? facts.stock.reduce((n, s) => n + s.value, 0) : null,
      purchases: facts.purchases,
      sales: facts.sales,
    },
    alerts: alerts.map((a) => ({
      ...a,
      review: reviewByFingerprint.get(a.fingerprint) || null,
    })),
    documents: documents
      .filter((d) => !onlyBook || d.bookId === onlyBook)
      .filter((d) => d.date >= from)
      .map(({ lines, ...d }) => ({
        ...d,
        total: lines.reduce((n, l) => n + l.netValue, 0),
        lineCount: lines.length,
      })),
    limitations: [
      "Dữ liệu từ chứng từ kế toán đã đối soát, không phải tự động đồng bộ toàn bộ hóa đơn thuế.",
      "Thuế suất cần đối chiếu hồ sơ/mặt hàng/ngày hiệu lực; không tự áp 8%.",
      "Phát hành hóa đơn điện tử chưa bật.",
    ],
  };
}
