import {
  pgTable,
  text,
  integer,
  primaryKey,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
/** Immutable uploaded source files; contracts retain exact brand/type/revision/digest references. */
export const contractTemplateSources = pgTable(
  "sales_contract_template_sources",
  {
    brand: text("brand").notNull(),
    documentType: text("document_type").notNull(),
    revision: integer("revision").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    sourceHash: text("source_hash").notNull(),
    clientKey: text("client_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.brand, t.documentType, t.revision] }),
    unique("uq_contract_template_sources_client").on(t.createdBy, t.clientKey),
    check(
      "sales_contract_template_sources_brand_check",
      sql`${t.brand} in ('BN','VG')`,
    ),
    check(
      "sales_contract_template_sources_document_type_check",
      sql`${t.documentType} in ('HDKT','TAM_UNG','BBNT')`,
    ),
    check(
      "sales_contract_template_sources_revision_check",
      sql`${t.revision}>0`,
    ),
    check(
      "sales_contract_template_sources_source_hash_check",
      sql`${t.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
).enableRLS();
