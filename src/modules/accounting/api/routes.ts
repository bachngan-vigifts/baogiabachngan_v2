import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  json,
  readJson,
  type Router,
  type RouteContext,
} from "../../../core/http/router.ts";
import { AppError } from "../../../core/errors.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import { salesOrders, salesOrderLines } from "../../sales/schema.ts";
import { products, productPrices, pricePolicies } from "../../catalog/schema.ts";
import { fold } from "../../../core/text/fold.ts";
import { posReturns } from "../../sales/return-schema.ts";
import { vietnamDate } from "../../sales/domain/sales.ts";
import {
  accountingEntities as entities,
  accountingBooks as books,
  accountingDocuments as docs,
  accountingLines as lines,
  accountingPeriods as periods,
  accountingReviews as reviews,
} from "../schema.ts";
import {
  canUseAccounting,
  day,
  taxCode,
  short,
  validateLines,
  ledger,
  periodMonths,
  type Kind,
  type Document,
} from "../domain/accounting.ts";
import {
  bookOf,
  documentsOf,
  entityLock,
  invalidateCoverage,
  snapshot,
  type Db,
} from "./store.ts";
import { accountingAssistant } from "./assistant.ts";
type Ctx = RouteContext<StaffEnv>;
const member = (c: Ctx) => (c.state.session as SessionState).member;
function access(c: Ctx, manager = false) {
  const m = member(c);
  if (!canUseAccounting(m) || (manager && m.role !== "manager"))
    throw new AppError(
      403,
      manager
        ? "Chỉ Manager được cấu hình hoặc duyệt sổ kế toán."
        : "Chỉ Manager và chức vụ Kế toán được vào Không gian kế toán.",
    );
  return m;
}
const now = () => new Date().toISOString();
const today = () => vietnamDate().iso;
const revision = (value: unknown, current: number) => {
  if (value !== current)
    throw new AppError(409, "Dữ liệu đã đổi. Tải lại trước khi lưu.");
};
const optional = (v: unknown, max = 1000) =>
  v === undefined || v === "" ? "" : short(v, max);
const counterpartyTax=(value:unknown)=>value===undefined||value===null||value===''?'':taxCode(value);
async function sourceOrder(db: Db, id: string, lock = false) {
  const q = db.select().from(salesOrders).where(eq(salesOrders.id, id));
  const [o] = lock ? await q.for("update") : await q.limit(1);
  if (
    !o ||
    !["confirmed", "delivering", "delivered"].includes(o.status) ||
    o.invoiceStatus === "issued"
  )
    throw new AppError(
      409,
      "Đơn không còn đủ điều kiện đối chiếu: cần đơn đã duyệt và chưa ghi xuất hóa đơn.",
    );
  const r = await db
    .select({ id: posReturns.id })
    .from(posReturns)
    .where(
      and(
        eq(posReturns.orderId, id),
        sql`${posReturns.status} not in ('cancelled','rejected')`,
      ),
    )
    .limit(1);
  if (r.length)
    throw new AppError(
      409,
      "Đơn có yêu cầu đổi/trả: cần đối soát riêng, không tự đề xuất đủ số lượng ban đầu.",
    );
  const original = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, id))
    .orderBy(asc(salesOrderLines.lineNo))
    .limit(301);
  if (
    !original.length ||
    original.length > 300 ||
    original.some(
      (l) =>
        !l.sku ||
        !l.unit ||
        !Number.isSafeInteger(Math.round(l.amount)) ||
        l.amount < 0 ||
        !Number.isFinite(l.qty) ||
        l.qty <= 0 ||
        Math.abs(l.qty - Math.round(l.qty * 1000) / 1000) > 1e-8 ||
        !Number.isFinite(l.taxRate) ||
        l.taxRate < 0 ||
        l.taxRate > 100,
    )
  )
    throw new AppError(
      422,
      "Đơn có dòng thiếu SKU/đơn vị hoặc phụ phí cần kế toán phân loại riêng.",
    );
  const rounded = original.map((l) => Math.floor(l.amount)),
    target = Math.round(original.reduce((n, l) => n + l.amount, 0));
  if (target !== Math.round(o.subtotal))
    throw new AppError(
      422,
      "Tổng dòng hàng khác tổng trước VAT của đơn (có thể có phụ phí). Cần đối soát riêng.",
    );
  const remaining = target - rounded.reduce((n, v) => n + v, 0),
    rank = original
      .map((l, i) => ({ i, remainder: l.amount - rounded[i]! }))
      .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0; i < remaining; i++) {
    const index = rank[i]!.i;
    rounded[index] = rounded[index]! + 1;
  }
  const proposed = original.map((l, i) => ({
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    quantity: l.qty,
    netValue: rounded[i]!,
    taxRate: l.taxRate,
    sourceLineId: l.id,
    carryingValue: null,
  }));
  return { order: o, lines: proposed };
}
export function registerAccountingWorkspaceRoutes(router: Router<StaffEnv>) {
  router.get(
    "/accounting/options",
    async (c) => {
      const m = access(c);
      const [e, b] = await Promise.all([
        c.env.db.select().from(entities).orderBy(asc(entities.name)),
        c.env.db.select().from(books).orderBy(asc(books.name)),
      ]);
      return json({
        entities: e,
        books: b,
        canConfigure: m.role === "manager",
        canApprove: m.role === "manager",
        canDraft: true,
        canIssue: false,
        aiAvailable: !!c.env.accountingAi,
        valuationMethod: "weighted-average",
        asOf: now(),
      });
    },
    "business",
  );
  router.post("/accounting/import-products", async (c) => {
    access(c);
    const body = await readJson(c.req, 400000);
    if (!Array.isArray(body.skus) || !body.skus.length || body.skus.length > 5000)
      throw new AppError(400, "Chọn 1–5.000 SKU.");
    const skus = [...new Set(body.skus.map((s: unknown) => short(s, 64)))];
    const policies = await c.env.db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.id));
    // Only the regular retail/list policy, never wholesale or VAT-inclusive fallback.
    const names = ["gia ban le", "gia le", "gia niem yet"];
    const policy = names.map(name => policies.find(p => fold(p.name) === name)).find(Boolean);
    const rows = await c.env.db.select({ sku: products.sku, name: products.name, unit: products.unit,
      unitPrice: productPrices.price })
      .from(products).leftJoin(productPrices, and(eq(productPrices.sku, products.sku),
        policy ? eq(productPrices.policyId, policy.id) : sql`false`))
      .where(inArray(products.sku, skus));
    return json({ products: rows.map(p => ({ ...p, unitPrice: typeof p.unitPrice === "number" && Number.isFinite(p.unitPrice) && p.unitPrice >= 0 && p.unitPrice <= 1e12 ? p.unitPrice : null })),
      pricePolicy: policy ? {id: policy.id, name: policy.name, basis: "before-vat"} : null, priceAsOf: now() });
  }, "business");
  router.post(
    "/accounting/entities",
    async (c) => {
      const m = access(c, true),
        body = await readJson(c.req, 10000),
        id = crypto.randomUUID(),
        date = now(),
        code = taxCode(body.taxCode);
      if (body.confirmed !== true)
        throw new AppError(
          400,
          "Xác nhận tên pháp nhân và MST theo hồ sơ đăng ký trước khi lưu.",
        );
      const exists = await c.env.db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.taxCode, code))
        .limit(1);
      if (exists.length)
        throw new AppError(
          409,
          "MST đã được cấu hình. Dùng lại pháp nhân hiện có.",
        );
      await c.env.db.insert(entities).values({
        id,
        name: short(body.name, 500),
        taxCode: code,
        createdBy: m.id,
        createdAt: date,
        updatedAt: date,
      });
      return json({ id }, 201);
    },
    "business",
  );
  router.put(
    "/accounting/entities/:id/policy",
    async (c) => {
      access(c, true);
      const b = await readJson(c.req, 10000),
        ref =
          b.referenceK == null || b.referenceK === ""
            ? null
            : Number(b.referenceK),
        slow = Number(b.slowDays),
        coverage = Number(b.coverageDays),
        ratio = Number(b.importRatio);
      if (
        ![slow, coverage].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= 3650,
        ) ||
        !Number.isFinite(ratio) ||
        ratio <= 0 ||
        ratio > 1000 ||
        (ref !== null && (!Number.isFinite(ref) || ref <= 0 || ref > 10000))
      )
        throw new AppError(
          400,
          "Ngưỡng quản trị hoặc tham số tham chiếu không hợp lệ.",
        );
      const source = ref === null ? "" : short(b.kSource, 1500),
        date = ref === null ? null : day(b.kVerifiedDate);
      if (date && date > today())
        throw new AppError(400, "Ngày xác nhận không được ở tương lai.");
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          e = await entityLock(db, c.params.id!);
        revision(b.revision, e.revision);
        await db
          .update(entities)
          .set({
            referenceK: ref === null ? null : String(ref),
            kSource: source,
            kVerifiedDate: date,
            slowDays: slow,
            coverageDays: coverage,
            importRatio: String(ratio),
            revision: e.revision + 1,
            updatedAt: now(),
          })
          .where(eq(entities.id, e.id));
      });
      return json({ ok: true });
    },
    "business",
  );
  router.post(
    "/accounting/books",
    async (c) => {
      const m = access(c, true),
        b = await readJson(c.req, 10000),
        id = crypto.randomUUID(),
        date = now(),
        name = short(b.name, 200);
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        if (b.entityId) await entityLock(db, short(b.entityId, 100));
        const existing = await db
          .select({ id: books.id })
          .from(books)
          .where(eq(books.name, name))
          .limit(1);
        if (existing.length) throw new AppError(409, "Tên sổ kho đã tồn tại.");
        await db.insert(books).values({
          id,
          name,
          invoiceProvider:
            b.invoiceProvider === "viettel" || b.invoiceProvider === "vnpt"
              ? b.invoiceProvider
              : null,
          entityId: b.entityId ? String(b.entityId) : null,
          createdBy: m.id,
          createdAt: date,
          updatedAt: date,
        });
      });
      return json({ id }, 201);
    },
    "business",
  );
  router.put(
    "/accounting/books/:id",
    async (c) => {
      access(c, true);
      const b = await readJson(c.req, 10000);
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        const old = await bookOf(db, c.params.id!);
        for (const entityId of [
          ...new Set(
            [old.entityId, b.entityId ? String(b.entityId) : null].filter(
              (x): x is string => !!x,
            ),
          ),
        ].sort())
          await entityLock(db, entityId);
        const [book] = await db
          .select()
          .from(books)
          .where(eq(books.id, old.id))
          .for("update");
        revision(b.revision, book!.revision);
        if (book!.entityId !== old.entityId)
          throw new AppError(409, "Sổ đã đổi, tải lại.");
        if ((b.entityId || null) !== old.entityId) {
          const used = await db
            .select({ id: docs.id })
            .from(docs)
            .where(eq(docs.bookId, old.id))
            .limit(1);
          if (used.length)
            throw new AppError(
              409,
              "Sổ đã có chứng từ; không đổi pháp nhân để sửa lịch sử.",
            );
        }
        await db
          .update(books)
          .set({
            name: short(b.name, 200),
            invoiceProvider:
              b.invoiceProvider === "viettel" || b.invoiceProvider === "vnpt"
                ? b.invoiceProvider
                : null,
            entityId: b.entityId ? String(b.entityId) : null,
            active: b.active !== false,
            revision: old.revision + 1,
            updatedAt: now(),
          })
          .where(eq(books.id, old.id));
      });
      return json({ ok: true });
    },
    "business",
  );
  router.get(
    "/accounting/report",
    async (c) => {
      access(c);
      const p = c.url.searchParams;
      return json(
        await c.env.db.transaction(async (tx) => {
          const db = tx as unknown as Db;
          await db.execute(
            sql`set transaction isolation level repeatable read read only`,
          );
          await db.execute(sql`set local statement_timeout='6000ms'`);
          return snapshot(
            db,
            short(p.get("entityId"), 100),
            day(p.get("from")),
            day(p.get("to")),
            p.get("bookId") || undefined,
          );
        }),
      );
    },
    "business",
  );
  router.get(
    "/accounting/documents/:id",
    async (c) => {
      access(c);
      const [d] = await c.env.db
        .select()
        .from(docs)
        .where(eq(docs.id, c.params.id!))
        .limit(1);
      if (!d) throw new AppError(404, "Không tìm thấy chứng từ.");
      return json({
        ...d,
        lines: await c.env.db
          .select()
          .from(lines)
          .where(eq(lines.documentId, d.id))
          .orderBy(asc(lines.lineNo)),
      });
    },
    "business",
  );
  router.post(
    "/accounting/books/:id/documents",
    async (c) => {
      const m = access(c),
        b = await readJson(c.req, 6000000),
        kind = b.kind as Kind,
        date = day(b.date),
        reference = short(b.reference, 120),
        draftLines =
          kind === "opening" &&
          Array.isArray(b.lines) &&
          b.lines.length === 0 &&
          b.confirmedZero === true
            ? []
            : validateLines(b.lines),
        id = crypto.randomUUID();
      if (
        ![
          "opening",
          "purchase",
          "sale",
          "purchase_return",
          "sale_return",
        ].includes(kind) ||
        date > today()
      )
        throw new AppError(400, "Loại/ngày chứng từ không hợp lệ.");
      if (kind === "sale" && b.sourceOrderId)
        throw new AppError(
          400,
          "Dùng luồng đối chiếu đơn bán; không gửi dòng hàng thay thế.",
        );
      if (kind.endsWith("_return"))
        throw new AppError(
          422,
          "Phiếu trả/điều chỉnh cần đối soát giá trị gốc; chưa bật ghi sổ trong phiên bản này.",
        );
      if (draftLines.reduce((n, l) => n + l.netValue, 0) > 9e12)
        throw new AppError(400, "Giá trị một chứng từ tối đa 9.000 tỷ VNĐ.");
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          book = await bookOf(db, c.params.id!);
        if (!book.entityId || !book.active)
          throw new AppError(
            409,
            "Gán pháp nhân/MST và bật sổ trước khi tạo chứng từ.",
          );
        await entityLock(db, book.entityId);
        const [locked] = await db
          .select()
          .from(books)
          .where(eq(books.id, book.id))
          .for("update");
        if (!locked?.active || locked.entityId !== book.entityId)
          throw new AppError(409, "Pháp nhân sổ đã đổi, tải lại.");
        if (b.relatedId) {
          const [related] = await db
            .select()
            .from(docs)
            .where(
              and(
                eq(docs.id, String(b.relatedId)),
                eq(docs.bookId, book.id),
                eq(docs.state, "posted"),
              ),
            )
            .limit(1);
          if (
            !related ||
            related.kind !== (kind === "sale_return" ? "sale" : "purchase")
          )
            throw new AppError(
              400,
              "Chứng từ gốc không khớp loại trả hàng/sổ kế toán.",
            );
        }
        const dup = await db
          .select({ id: docs.id })
          .from(docs)
          .where(
            and(
              eq(docs.entityId, book.entityId),
              eq(docs.kind, kind),
              eq(docs.reference, reference),
              eq(docs.series, optional(b.series, 50)),
              eq(docs.counterpartyTaxCode, counterpartyTax(b.counterpartyTaxCode)),
              ne(docs.state, "voided"),
            ),
          )
          .limit(1);
        if (dup.length)
          throw new AppError(409, "Chứng từ đã tồn tại. Không tạo bản trùng.");
        const [usage] = await db.select({ n: sql<number>`count(*)::int` })
          .from(lines).innerJoin(docs, eq(lines.documentId, docs.id))
          .where(eq(docs.entityId, book.entityId));
        if (Number(usage?.n || 0) + draftLines.length > 10000)
          throw new AppError(413, "Tổng phạm vi pháp nhân vượt 10.000 dòng báo cáo hiện hỗ trợ. Chưa lưu chứng từ; cần nâng cấp báo cáo trước, không cắt dữ liệu.");
        await db.insert(docs).values({
          id,
          bookId: book.id,
          entityId: book.entityId,
          kind,
          date,
          reference,
          series: optional(b.series, 50),
          counterpartyTaxCode: counterpartyTax(b.counterpartyTaxCode),
          relatedId: b.relatedId ? String(b.relatedId) : null,
          note: optional(b.note, 1500),
          createdBy: m.id,
          createdAt: now(),
        });
        // Bound parameters per insert; all batches share the same transaction.
        for (let start = 0; start < draftLines.length; start += 200) {
          await db.insert(lines).values(
            draftLines.slice(start, start + 200).map((l, i) => ({
              ...l,
              quantity: String(l.quantity),
              taxRate: l.taxRate === null ? null : String(l.taxRate),
              documentId: id,
              lineNo: start + i + 1,
            })),
          );
        }
      });
      return json(
        { id, state: "draft", physicalInventoryAffected: false },
        201,
      );
    },
    "business",
  );
  router.post(
    "/accounting/documents/:id/post",
    async (c) => {
      const m = access(c, true),
        b = await readJson(c.req, 10000);
      if (b.confirmed !== true)
        throw new AppError(400, "Cần xác nhận đã đối soát chứng từ gốc.");
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          [before] = await db
            .select()
            .from(docs)
            .where(eq(docs.id, c.params.id!))
            .limit(1);
        if (!before) throw new AppError(404, "Không tìm thấy chứng từ.");
        await entityLock(db, before.entityId);
        const [d] = await db
          .select()
          .from(docs)
          .where(eq(docs.id, before.id))
          .for("update");
        if (d!.state === "posted") {
          revision(b.revision, d!.revision);
          return;
        }
        revision(b.revision, d!.revision);
        if (d!.state !== "draft")
          throw new AppError(409, "Chứng từ không còn là nháp.");
        const book = await bookOf(db, d!.bookId);
        if (!book.active || book.entityId !== d!.entityId)
          throw new AppError(409, "Sổ/pháp nhân không còn hợp lệ.");
        if (d!.sourceOrderId) {
          const current = await sourceOrder(db, d!.sourceOrderId, true);
          if (current.order.revision !== d!.sourceRevision)
            throw new AppError(
              409,
              "Đơn bán đã đổi. Hủy nháp và đối chiếu lại trước khi ghi sổ.",
            );
        }
        const existing = await documentsOf(db, [book.id], "9999-12-31");
        if (d!.kind === "opening") {
          if (book.openingDate || existing.some((x) => x.state === "posted"))
            throw new AppError(
              409,
              "Sổ đã mở/đã có chứng từ. Không ghi số dư đầu kỳ lần hai.",
            );
        } else if (!book.openingDate || d!.date < book.openingDate)
          throw new AppError(
            409,
            "Chốt đầu kỳ trước; ngày chứng từ không được trước ngày mở sổ.",
          );
        const facts = ledger(
          existing.map((x) =>
            x.id === d!.id ? { ...x, state: "posted" } : x,
          ) as Document[],
          "2000-01-01",
          "9999-12-31",
        );
        if (
          facts.anomalies.some(
            (a) =>
              a.code === "negative_stock" || a.code === "return_source_missing",
          )
        )
          throw new AppError(
            409,
            "Ghi sổ gây âm tồn/giá trị hoặc thiếu giá trị trả gốc. Kiểm tra thứ tự và chứng từ nguồn.",
          );
        await db
          .update(docs)
          .set({
            state: "posted",
            postedAt: now(),
            postedBy: m.id,
            revision: d!.revision + 1,
          })
          .where(eq(docs.id, d!.id));
        if (d!.kind === "opening")
          await db
            .update(books)
            .set({
              openingDate: d!.date,
              revision: book.revision + 1,
              updatedAt: now(),
            })
            .where(eq(books.id, book.id));
        await invalidateCoverage(db, d!.entityId, d!.date);
      });
      return json({
        ok: true,
        physicalInventoryAffected: false,
        invoiceIssued: false,
      });
    },
    "business",
  );
  router.post(
    "/accounting/documents/:id/void",
    async (c) => {
      access(c, true);
      const b = await readJson(c.req, 10000),
        reason = short(b.reason, 500);
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          [initial] = await db
            .select()
            .from(docs)
            .where(eq(docs.id, c.params.id!))
            .limit(1);
        if (!initial) throw new AppError(404, "Không tìm thấy chứng từ.");
        await entityLock(db, initial.entityId);
        const [d] = await db
          .select()
          .from(docs)
          .where(eq(docs.id, initial.id))
          .for("update");
        revision(b.revision, d!.revision);
        if (d!.state === "voided")
          throw new AppError(409, "Chứng từ đã hủy đối chiếu.");
        const existing = await documentsOf(db, [d!.bookId], "9999-12-31");
        if (d!.state === "posted") {
          if (
            existing.some((x) => x.relatedId === d!.id && x.state === "posted")
          )
            throw new AppError(
              409,
              "Chứng từ có phiếu trả đã ghi sổ; đối soát chuỗi chứng từ trước.",
            );
          const after = ledger(
            existing.filter((x) => x.id !== d!.id) as Document[],
            "2000-01-01",
            "9999-12-31",
          );
          if (after.anomalies.some((a) => a.code === "negative_stock"))
            throw new AppError(
              409,
              "Bỏ chứng từ làm âm tồn ở chứng từ sau. Cần đối soát trước.",
            );
          if (
            d!.kind === "opening" &&
            existing.some((x) => x.id !== d!.id && x.state === "posted")
          )
            throw new AppError(409, "Không hủy đầu kỳ khi đã có phát sinh.");
        }
        await db
          .update(docs)
          .set({
            state: "voided",
            voidReason: reason,
            revision: d!.revision + 1,
          })
          .where(eq(docs.id, d!.id));
        if (d!.kind === "opening" && d!.state === "posted")
          await db
            .update(books)
            .set({
              openingDate: null,
              updatedAt: now(),
              revision: sql`${books.revision}+1`,
            })
            .where(eq(books.id, d!.bookId));
        await invalidateCoverage(db, d!.entityId, d!.date);
      });
      return json({
        ok: true,
        physicalInventoryAffected: false,
        externalInvoiceCancelled: false,
      });
    },
    "business",
  );
  router.post(
    "/accounting/periods/confirm",
    async (c) => {
      const m = access(c, true),
        b = await readJson(c.req, 10000),
        month = short(b.month, 7);
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
        month >= today().slice(0, 7)
      )
        throw new AppError(400, "Chỉ xác nhận kỳ đã kết thúc.");
      if (b.confirmed !== true)
        throw new AppError(
          400,
          "Cần xác nhận đủ hóa đơn và điều chỉnh của kỳ.",
        );
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          e = await entityLock(db, short(b.entityId, 100));
        await db
          .insert(periods)
          .values({
            entityId: e.id,
            month,
            reference: short(b.reference, 1000),
            verifiedBy: m.id,
            verifiedAt: now(),
          })
          .onConflictDoUpdate({
            target: [periods.entityId, periods.month],
            set: {
              reference: short(b.reference, 1000),
              verifiedBy: m.id,
              verifiedAt: now(),
            },
          });
      });
      return json({ ok: true });
    },
    "business",
  );
  router.post(
    "/accounting/reviews",
    async (c) => {
      const m = access(c),
        b = await readJson(c.req, 10000);
      if (!["open", "investigating", "resolved"].includes(String(b.status)))
        throw new AppError(400, "Trạng thái đối soát không hợp lệ.");
      const note = short(b.note, 1000);
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        await entityLock(db, short(b.entityId, 100));
        const report = await snapshot(
            db,
            short(b.entityId, 100),
            day(b.from),
            day(b.to),
            b.bookId ? short(b.bookId, 100) : undefined,
          ),
          a = report.alerts.find((a) => a.fingerprint === b.fingerprint);
        if (!a)
          throw new AppError(
            409,
            "Cảnh báo đã thay đổi. Tải lại trước khi ghi chú.",
          );
        const [old] = await db
          .select()
          .from(reviews)
          .where(eq(reviews.fingerprint, a.fingerprint))
          .limit(1);
        revision(b.revision, old?.revision || 0);
        await db
          .insert(reviews)
          .values({
            fingerprint: a.fingerprint,
            entityId: short(b.entityId, 100),
            status: b.status as "open" | "investigating" | "resolved",
            note,
            updatedBy: m.id,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: reviews.fingerprint,
            set: {
              status: b.status as "open" | "investigating" | "resolved",
              note,
              updatedBy: m.id,
              updatedAt: now(),
              revision: (old?.revision || 0) + 1,
            },
          });
      });
      return json({ ok: true });
    },
    "business",
  );
  router.get(
    "/accounting/source-orders",
    async (c) => {
      access(c);
      const q = (c.url.searchParams.get("q") || "").trim();
      if (q.length < 2 || q.length > 100)
        throw new AppError(400, "Nhập ít nhất 2 ký tự số đơn, tối đa 100.");
      const rows = await c.env.db
        .select({
          id: salesOrders.id,
          orderNo: salesOrders.orderNo,
          date: salesOrders.orderDate,
          status: salesOrders.status,
          total: salesOrders.total,
          invoiceStatus: salesOrders.invoiceStatus,
        })
        .from(salesOrders)
        .where(
          and(
            inArray(salesOrders.status, [
              "confirmed",
              "delivering",
              "delivered",
            ]),
            sql`${salesOrders.orderNo} ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}`,
          ),
        )
        .orderBy(desc(salesOrders.orderDate))
        .limit(25);
      return json({ orders: rows });
    },
    "business",
  );
  router.get(
    "/accounting/books/:id/suggest",
    async (c) => {
      access(c);
      const book = await bookOf(c.env.db, c.params.id!);
      if (!book.active || !book.entityId || !book.openingDate)
        throw new AppError(
          409,
          "Cấu hình pháp nhân và đầu kỳ trước khi đối chiếu.",
        );
      const source = await sourceOrder(
        c.env.db,
        short(c.url.searchParams.get("orderId"), 100),
      );
      const facts = ledger(
        (await documentsOf(c.env.db, [book.id], today())) as Document[],
        "2000-01-01",
        today(),
      );
      return json({
        order: {
          id: source.order.id,
          orderNo: source.order.orderNo,
          revision: source.order.revision,
        },
        mode: "exact-sku-unit",
        canIssue: false,
        lines: source.lines.map((l) => ({
          ...l,
          available:
            facts.stock.find((s) => s.sku === l.sku && s.unit === l.unit)
              ?.quantity ?? null,
          reason:
            "Giữ đúng mã, đơn vị, số lượng và tiền trước VAT của đơn bán. Không chọn mã khác theo số tiền.",
        })),
        physicalInventoryAffected: false,
      });
    },
    "business",
  );
  router.post(
    "/accounting/books/:id/sale-drafts",
    async (c) => {
      const m = access(c),
        b = await readJson(c.req, 10000),
        id = crypto.randomUUID();
      if (b.confirmedEntity !== true || day(b.date) > today())
        throw new AppError(
          400,
          "Cần xác nhận đúng pháp nhân của đơn bán và ngày không ở tương lai.",
        );
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          book = await bookOf(db, c.params.id!);
        if (!book.entityId || !book.openingDate || !book.active)
          throw new AppError(409, "Sổ cần pháp nhân và đầu kỳ đã duyệt.");
        await entityLock(db, book.entityId);
        const [locked] = await db
          .select()
          .from(books)
          .where(eq(books.id, book.id))
          .for("update");
        if (
          !locked?.active ||
          locked.entityId !== book.entityId ||
          !locked.openingDate
        )
          throw new AppError(409, "Thiết lập sổ đã đổi.");
        const source = await sourceOrder(db, short(b.orderId, 100), true);
        revision(b.sourceRevision, source.order.revision);
        const [used] = await db
          .select({ id: docs.id })
          .from(docs)
          .where(
            and(
              eq(docs.sourceOrderId, source.order.id),
              ne(docs.state, "voided"),
            ),
          )
          .limit(1);
        if (used)
          throw new AppError(
            409,
            "Đơn đã có bản đối chiếu; không tạo hóa đơn trùng.",
          );
        await db.insert(docs).values({
          id,
          bookId: book.id,
          entityId: book.entityId,
          kind: "sale",
          date: day(b.date),
          reference: short(b.reference, 120),
          series: optional(b.series, 50),
          counterpartyTaxCode: counterpartyTax(source.order.taxCode),
          sourceOrderId: source.order.id,
          sourceRevision: source.order.revision,
          note:
            "Bản đối chiếu từ đơn " +
            source.order.orderNo +
            "; chưa phát hành hóa đơn.",
          createdBy: m.id,
          createdAt: now(),
        });
        await db.insert(lines).values(
          source.lines.map((l, i) => ({
            ...l,
            quantity: String(l.quantity),
            taxRate: String(l.taxRate),
            documentId: id,
            lineNo: i + 1,
          })),
        );
      });
      return json(
        {
          id,
          state: "draft",
          invoiceIssued: false,
          physicalInventoryAffected: false,
        },
        201,
      );
    },
    "business",
  );
  router.post(
    "/accounting/assistant",
    async (c) => {
      access(c);
      const b = await readJson(c.req, 10000),
        report = await snapshot(
          c.env.db,
          short(b.entityId, 100),
          day(b.from),
          day(b.to),
          b.bookId ? short(b.bookId, 100) : undefined,
        );
      const a = report.alerts.find((a) => a.fingerprint === b.fingerprint);
      if (!a)
        throw new AppError(
          409,
          "Cảnh báo đã đổi. Tải lại trước khi hỏi trợ lý.",
        );
      return json(
        await accountingAssistant(c.env.accountingAi, {
          code: a.code,
          value: a.value ?? null,
          kState: report.k.state,
          coverage: report.coverage.opened,
        }),
      );
    },
    "business",
  );
}
