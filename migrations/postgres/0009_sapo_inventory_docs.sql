CREATE TABLE "sapo_inventory_doc_lines" (
	"doc_id" text NOT NULL,
	"line_no" bigint NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"variant_id" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"qty" double precision DEFAULT 0 NOT NULL,
	"diff_qty" double precision,
	"price" double precision,
	CONSTRAINT "sapo_inventory_doc_lines_doc_id_line_no_pk" PRIMARY KEY("doc_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "sapo_inventory_doc_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sapo_inventory_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sapo_id" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"location_name" text DEFAULT '' NOT NULL,
	"to_location_name" text DEFAULT '' NOT NULL,
	"partner_name" text DEFAULT '' NOT NULL,
	"total_qty" double precision DEFAULT 0 NOT NULL,
	"total_amount" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_on" text,
	"modified_on" text,
	"data" text DEFAULT '{}' NOT NULL,
	"synced_at" text NOT NULL,
	CONSTRAINT "chk_sapo_inventory_docs_kind" CHECK ("sapo_inventory_docs"."kind" IN ('purchase_order', 'stock_transfer', 'stock_adjustment'))
);
--> statement-breakpoint
ALTER TABLE "sapo_inventory_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sapo_inventory_doc_lines" ADD CONSTRAINT "sapo_inventory_doc_lines_doc_id_sapo_inventory_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."sapo_inventory_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sapo_inventory_doc_lines_sku" ON "sapo_inventory_doc_lines" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sapo_inventory_docs_kind_sapo" ON "sapo_inventory_docs" USING btree ("kind","sapo_id");--> statement-breakpoint
CREATE INDEX "idx_sapo_inventory_docs_kind_created" ON "sapo_inventory_docs" USING btree ("kind","created_on");--> statement-breakpoint
CREATE INDEX "idx_sapo_inventory_docs_code" ON "sapo_inventory_docs" USING btree ("code");