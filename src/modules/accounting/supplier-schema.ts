import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  bigint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { accountingDocuments } from "./schema.ts";
import { supplierPortalInvoices } from "../suppliers/workspace-schema.ts";
import { suppliers, incomingShipments } from "../suppliers/schema.ts";
import { employees } from "../staff/schema.ts";
export const accountingSupplierLinks = pgTable(
  "accounting_supplier_links",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => accountingDocuments.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => supplierPortalInvoices.id),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => incomingShipments.id),
    shared: boolean("shared").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: text("created_at").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => employees.id),
    reason: text("reason").notNull().default(""),
  },
  (t) => [
    uniqueIndex("uq_accounting_supplier_document")
      .on(t.documentId)
      .where(sql`${t.revokedAt} is null`),
    uniqueIndex("uq_accounting_supplier_invoice")
      .on(t.invoiceId)
      .where(sql`${t.revokedAt} is null`),
    index("idx_accounting_supplier_scope")
      .on(t.supplierId, t.shipmentId)
      .where(sql`${t.revokedAt} is null`),
    check("accounting_supplier_links_revision_check", sql`${t.revision}>0`),
    check(
      "accounting_supplier_links_check",
      sql`${t.revokedAt} is null or (${t.revokedBy} is not null and length(${t.reason})>0)`,
    ),
  ],
).enableRLS();
