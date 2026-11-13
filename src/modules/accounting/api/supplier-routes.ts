import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Router, RouteContext } from "../../../core/http/router.ts";
import { json, readJson } from "../../../core/http/router.ts";
import { AppError } from "../../../core/errors.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import {
  suppliers,
  incomingShipments,
  incomingShipmentLines,
} from "../../suppliers/schema.ts";
import { supplierPortalInvoices as invoices } from "../../suppliers/workspace-schema.ts";
import { accountingSupplierLinks as links } from "../supplier-schema.ts";
import {
  accountingDocuments as docs,
  accountingLines as lines,
  accountingBooks as books,
  accountingEntities as entities,
} from "../schema.ts";
import { canUseAccounting, short, taxCode } from "../domain/accounting.ts";
import { entityLock, type Db } from "./store.ts";
import { workspaceList } from "../../suppliers/api/workspace-store.ts";
import { vietnamDate } from "../../sales/domain/sales.ts";
type Ctx = RouteContext<StaffEnv>;
const access = (c: Ctx) => {
  const m = (c.state.session as SessionState).member;
  if (!canUseAccounting(m))
    throw new AppError(403, "Chỉ Manager/Kế toán được đối chiếu sổ với NCC.");
  return m;
};
const now = () => new Date().toISOString();
async function supplier(db: Db, id: string) {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!s) throw new AppError(404, "Không tìm thấy NCC.");
  return s;
}
async function invoice(db: Db, supplierId: string, id: string, lock = false) {
  const q = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.supplierId, supplierId)));
  const [i] = lock ? await q.for("update") : await q.limit(1);
  if (!i) throw new AppError(404, "Không tìm thấy hóa đơn của NCC.");
  return i;
}
function matches(
  doc: typeof docs.$inferSelect,
  rows: (typeof lines.$inferSelect)[],
  i: typeof invoices.$inferSelect,
  supplierTax: string,
) {
  if (
    doc.state !== "posted" ||
    doc.kind !== "purchase" ||
    doc.reference !== i.invoiceNo ||
    doc.series !== i.series ||
    doc.date !== i.invoiceDate ||
    doc.counterpartyTaxCode !== supplierTax ||
    !rows.length ||
    rows.some((l) => l.taxRate === null)
  )
    return false;
  const net = rows.reduce((n, l) => n + l.netValue, 0),
    tax =
      Math.round(
        rows.reduce((n, l) => n + (l.netValue * Number(l.taxRate)) / 100, 0) *
          100,
      ) / 100;
  return (
    Math.abs(net - i.subtotal) < 0.01 &&
    Math.abs(tax - i.tax) < 0.01 &&
    Math.abs(net + tax - i.total) < 0.01
  );
}
export function registerAccountingSupplierRoutes(router: Router<StaffEnv>) {
  router.get(
    "/accounting/suppliers/:id",
    async (c) => {
      access(c);
      const s = await supplier(c.env.db, c.params.id!),
        params = new URLSearchParams(c.url.search),
        invoiceParams = new URLSearchParams(params),
        balanceParams = new URLSearchParams(params);
      invoiceParams.set("offset", params.get("invoiceOffset") || "0");
      balanceParams.set("offset", params.get("balanceOffset") || "0");
      const today = vietnamDate().iso;
      const [invoiceList, balances] = await Promise.all([
        workspaceList(c.env.db, s.id, "invoices", invoiceParams, today),
        workspaceList(c.env.db, s.id, "balances", balanceParams, today),
      ]);
      const invoiceIds = invoiceList.items.map((i) => i.id);
      const linked = invoiceIds.length
        ? await c.env.db
            .select({
              id: links.id,
              invoiceId: links.invoiceId,
              documentId: links.documentId,
              shared: links.shared,
              revision: links.revision,
              state: docs.state,
              bookName: books.name,
            })
            .from(links)
            .innerJoin(docs, eq(docs.id, links.documentId))
            .innerJoin(books, eq(books.id, docs.bookId))
            .where(
              and(
                eq(links.supplierId, s.id),
                inArray(links.invoiceId, invoiceIds),
                isNull(links.revokedAt),
              ),
            )
            .orderBy(desc(links.createdAt))
        : [];
      return json({
        supplier: { id: s.id, name: s.name },
        invoices: invoiceList,
        balances,
        links: linked,
        canVerify: (c.state.session as SessionState).member.role === "manager",
        debtBasis:
          "Công nợ theo đơn mua và phiếu chi có hiệu lực; không cộng thêm hóa đơn liên kết.",
        asOf: today,
      });
    },
    "business",
  );
  router.get(
    "/accounting/suppliers/:id/invoice-options",
    async (c) => {
      access(c);
      const s = await supplier(c.env.db, c.params.id!),
        i = await invoice(
          c.env.db,
          s.id,
          short(c.url.searchParams.get("invoiceId"), 100),
        );
      if (i.status !== "verified")
        throw new AppError(
          409,
          "Manager đối chiếu hóa đơn NCC trước khi nối sổ.",
        );
      const code = taxCode(s.taxCode);
      const candidates = await c.env.db
        .select({
          document: docs,
          bookName: books.name,
          entityName: entities.name,
          entityTaxCode: entities.taxCode,
        })
        .from(docs)
        .innerJoin(books, eq(books.id, docs.bookId))
        .innerJoin(entities, eq(entities.id, docs.entityId))
        .where(
          and(
            eq(docs.kind, "purchase"),
            eq(docs.state, "posted"),
            eq(docs.reference, i.invoiceNo),
            eq(docs.series, i.series),
            eq(docs.date, i.invoiceDate),
            eq(docs.counterpartyTaxCode, code),
            eq(books.active, true),
          ),
        )
        .orderBy(asc(docs.id))
        .limit(101);
      if (candidates.length > 100)
        throw new AppError(
          413,
          "Quá nhiều chứng từ trùng thông tin; đối soát pháp nhân trước.",
        );
      const rows = candidates.length
        ? await c.env.db
            .select()
            .from(lines)
            .where(
              inArray(
                lines.documentId,
                candidates.map((d) => d.document.id),
              ),
            )
        : [];
      return json({
        invoiceId: i.id,
        options: candidates
          .filter((d) =>
            matches(
              d.document,
              rows.filter((l) => l.documentId === d.document.id),
              i,
              code,
            ),
          )
          .map((d) => ({
            id: d.document.id,
            bookName: d.bookName,
            entityName: d.entityName,
            entityTaxCode: d.entityTaxCode,
            reference: d.document.reference,
            date: d.document.date,
          })),
        message:
          "Chỉ chứng từ mua đã duyệt khớp số/ký hiệu/ngày/MST/tiền trước VAT và VAT. Không tự chọn pháp nhân.",
      });
    },
    "business",
  );
  router.post(
    "/accounting/suppliers/:id/links",
    async (c) => {
      const m = access(c),
        b = await readJson(c.req, 10000);
      if (b.confirmed !== true || typeof b.shared !== "boolean")
        throw new AppError(
          400,
          "Cần xác nhận đúng pháp nhân và lựa chọn chia sẻ trạng thái với NCC.",
        );
      const documentId = short(b.documentId, 100),
        invoiceId = short(b.invoiceId, 100);
      const result = await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          [initial] = await db
            .select()
            .from(docs)
            .where(eq(docs.id, documentId))
            .limit(1);
        if (!initial) throw new AppError(404, "Không tìm thấy chứng từ mua.");
        await entityLock(db, initial.entityId);
        const [d] = await db
            .select()
            .from(docs)
            .where(eq(docs.id, documentId))
            .for("update"),
          [s] = await db
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, c.params.id!))
            .for("update");
        if (!s) throw new AppError(404, "Không tìm thấy NCC.");
        const i = await invoice(db, s.id, invoiceId, true),
          [order] = await db
            .select()
            .from(incomingShipments)
            .where(eq(incomingShipments.id, i.shipmentId))
            .for("update"),
          [book] = await db
            .select()
            .from(books)
            .where(eq(books.id, d!.bookId))
            .limit(1),
          rows = await db
            .select()
            .from(lines)
            .where(eq(lines.documentId, documentId));
        if (
          !book?.active ||
          book.entityId !== d!.entityId ||
          !order ||
          order.supplierId !== s.id ||
          order.source !== "supplier-order" ||
          order.approvalStatus !== "approved" ||
          order.cancelledAt ||
          i.status !== "verified" ||
          !matches(d!, rows, i, taxCode(s.taxCode))
        )
          throw new AppError(
            409,
            "Chứng từ chưa khớp NCC/pháp nhân/đơn/số hóa đơn/ngày/giá trị, hoặc chưa được duyệt.",
          );
        const ordered = await db
          .select({
            sku: incomingShipmentLines.sku,
            unit: incomingShipmentLines.unit,
            quantity: incomingShipmentLines.quantity,
          })
          .from(incomingShipmentLines)
          .where(eq(incomingShipmentLines.shipmentId, order.id));
        const orderedQty = new Map<string, number>(),
          documentQty = new Map<string, number>();
        for (const l of ordered) {
          const key = l.sku + "\0" + l.unit;
          orderedQty.set(key, (orderedQty.get(key) || 0) + l.quantity);
        }
        for (const l of rows) {
          const key = l.sku + "\0" + l.unit;
          documentQty.set(
            key,
            (documentQty.get(key) || 0) + Number(l.quantity),
          );
        }
        for (const [key, quantity] of documentQty)
          if (!orderedQty.has(key) || quantity > orderedQty.get(key)! + 1e-8)
            throw new AppError(
              409,
              "SKU/đơn vị/số lượng chứng từ không khớp đơn mua gốc.",
            );
        const active = await db
          .select()
          .from(links)
          .where(
            and(
              isNull(links.revokedAt),
              sql`(${links.invoiceId}=${invoiceId} or ${links.documentId}=${documentId})`,
            ),
          )
          .limit(2);
        if (active.length) {
          const same = active.find(
            (l) =>
              l.invoiceId === i.id &&
              l.documentId === d!.id &&
              l.supplierId === s.id &&
              l.shared === b.shared,
          );
          if (same) return { id: same.id, replayed: true };
          throw new AppError(
            409,
            "Hóa đơn hoặc chứng từ đã liên kết. Thu hồi liên kết cũ trước khi đổi.",
          );
        }
        const id = crypto.randomUUID();
        const inserted = await db
          .insert(links)
          .values({
            id,
            documentId,
            invoiceId,
            supplierId: s.id,
            shipmentId: i.shipmentId,
            shared: b.shared === true,
            createdBy: m.id,
            createdAt: now(),
          })
          .onConflictDoNothing()
          .returning({ id: links.id });
        if (!inserted.length)
          throw new AppError(409, "Liên kết đã được tạo đồng thời, tải lại.");
        return { id, replayed: false };
      });
      return json(
        { ...result, physicalInventoryAffected: false, payablesChanged: false },
        201,
      );
    },
    "business",
  );
  router.post(
    "/accounting/supplier-links/:id/revoke",
    async (c) => {
      const m = access(c),
        b = await readJson(c.req, 10000),
        reason = short(b.reason, 1000);
      await c.env.db.transaction(async (tx) => {
        const db = tx as unknown as Db,
          [l] = await db
            .select()
            .from(links)
            .where(eq(links.id, c.params.id!))
            .for("update");
        if (!l) throw new AppError(404, "Không tìm thấy liên kết.");
        if (l.revokedAt || b.revision !== l.revision)
          throw new AppError(409, "Liên kết đã thay đổi, tải lại.");
        await db
          .update(links)
          .set({
            revokedAt: now(),
            revokedBy: m.id,
            reason,
            revision: l.revision + 1,
          })
          .where(eq(links.id, l.id));
      });
      return json({ ok: true, payablesChanged: false });
    },
    "business",
  );
}
