import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  bigint,
  boolean,
  numeric,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { employees } from "../staff/schema.ts";
import { salesOrders } from "../sales/schema.ts";
/** Fiscal subledgers: deliberately NOT catalog warehouses or physical stock moves. */
export const accountingEntities = pgTable(
  "accounting_entities",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    taxCode: text("tax_code").notNull(),
    referenceK: numeric("reference_k", { precision: 12, scale: 4 }),
    kSource: text("k_source").notNull().default(""),
    kVerifiedDate: text("k_verified_date"),
    slowDays: bigint("slow_days", { mode: "number" }).notNull().default(90),
    coverageDays: bigint("coverage_days", { mode: "number" })
      .notNull()
      .default(180),
    importRatio: numeric("import_ratio", { precision: 12, scale: 4 })
      .notNull()
      .default("3"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_accounting_entity_tax").on(t.taxCode),
    check(
      "ck_accounting_entity_tax",
      sql`${t.taxCode} ~ '^[0-9]{10}([0-9]{3})?$'`,
    ),
    check(
      "ck_accounting_reference_k",
      sql`${t.referenceK} is null or (${t.referenceK}>0 and ${t.referenceK}<>'NaN'::numeric and length(${t.kSource})>0 and ${t.kVerifiedDate} is not null)`,
    ),
    check(
      "ck_accounting_policy",
      sql`${t.slowDays}>0 and ${t.coverageDays}>0 and ${t.importRatio}>0 and ${t.importRatio}<>'NaN'::numeric`,
    ),
  ],
).enableRLS();
export const accountingBooks = pgTable(
  "accounting_books",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    entityId: text("entity_id").references(() => accountingEntities.id),
    invoiceProvider: text("invoice_provider", { enum: ["viettel", "vnpt"] }),
    openingDate: text("opening_date"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => employees.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_accounting_book_name").on(t.name),
    index("idx_accounting_book_entity").on(t.entityId),
  ],
).enableRLS();
export const accountingDocuments = pgTable(
  "accounting_documents",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => accountingBooks.id),
    entityId: text("entity_id")
      .notNull()
      .references(() => accountingEntities.id),
    kind: text("kind", {
      enum: ["opening", "purchase", "sale", "purchase_return", "sale_return"],
    }).notNull(),
    state: text("state", { enum: ["draft", "posted", "voided"] })
      .notNull()
      .default("draft"),
    date: text("date").notNull(),
    reference: text("reference").notNull(),
    series: text("series").notNull().default(""),
    counterpartyTaxCode: text("counterparty_tax_code").notNull().default(""),
    sourceOrderId: text("source_order_id").references(() => salesOrders.id),
    sourceRevision: bigint("source_revision", { mode: "number" }),
    relatedId: text("related_id"),
    note: text("note").notNull().default(""),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: text("created_at").notNull(),
    postedBy: text("posted_by").references(() => employees.id),
    postedAt: text("posted_at"),
    voidReason: text("void_reason"),
  },
  (t) => [
    index("idx_accounting_document_book_date").on(t.bookId, t.date),
    index("idx_accounting_document_entity_date").on(t.entityId, t.date),
    uniqueIndex("uq_accounting_document_reference")
      .on(t.entityId, t.kind, t.series, t.reference, t.counterpartyTaxCode)
      .where(sql`${t.state}<>'voided'`),
    uniqueIndex("uq_accounting_source_order")
      .on(t.sourceOrderId)
      .where(sql`${t.state}<>'voided'`),
    uniqueIndex("uq_accounting_book_opening")
      .on(t.bookId)
      .where(sql`${t.kind}='opening' and ${t.state}='posted'`),
    check(
      "ck_accounting_document_kind",
      sql`${t.kind} in ('opening','purchase','sale','purchase_return','sale_return')`,
    ),
    check(
      "ck_accounting_document_state",
      sql`${t.state} in ('draft','posted','voided')`,
    ),
    check(
      "ck_accounting_document_date",
      sql`${t.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check(
      "ck_accounting_posted",
      sql`${t.state}<>'posted' or (${t.postedBy} is not null and ${t.postedAt} is not null)`,
    ),
  ],
).enableRLS();
export const accountingLines = pgTable(
  "accounting_lines",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => accountingDocuments.id),
    lineNo: bigint("line_no", { mode: "number" }).notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    netValue: bigint("net_value", { mode: "number" }).notNull(),
    carryingValue: bigint("carrying_value", { mode: "number" }),
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }),
    sourceLineId: text("source_line_id"),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.lineNo] }),
    check(
      "ck_accounting_line_qty",
      sql`${t.quantity}>0 and ${t.quantity} <> 'NaN'::numeric and ${t.netValue}>=0 and ${t.netValue}<=9000000000000 and (${t.carryingValue} is null or (${t.carryingValue}>=0 and ${t.carryingValue}<=9000000000000))`,
    ),
    check(
      "ck_accounting_line_tax",
      sql`${t.taxRate} is null or (${t.taxRate}>=0 and ${t.taxRate}<=100)`,
    ),
  ],
).enableRLS();
/** Explicit coverage confirmation; without it K is unknown, never green. */
export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => accountingEntities.id),
    month: text("month").notNull(),
    reference: text("reference").notNull(),
    verifiedBy: text("verified_by")
      .notNull()
      .references(() => employees.id),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.month] }),
    check(
      "ck_accounting_month",
      sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
).enableRLS();
export const accountingReviews = pgTable(
  "accounting_reviews",
  {
    fingerprint: text("fingerprint").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => accountingEntities.id),
    status: text("status", {
      enum: ["open", "investigating", "resolved"],
    }).notNull(),
    note: text("note").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => employees.id),
    updatedAt: text("updated_at").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
  },
  (t) => [
    index("idx_accounting_review_entity").on(t.entityId),
    check(
      "ck_accounting_review_status",
      sql`${t.status} in ('open','investigating','resolved')`,
    ),
  ],
).enableRLS();
