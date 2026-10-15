CREATE TABLE "stock_balances" (
	"sku" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"qty" double precision DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "stock_balances_sku_warehouse_id_pk" PRIMARY KEY("sku","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "stock_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"qty" double precision NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"ref_no" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_stock_moves_kind" CHECK ("stock_moves"."kind" IN ('opening', 'receipt', 'issue', 'adjust', 'reverse')),
	CONSTRAINT "chk_stock_moves_ref_type" CHECK ("stock_moves"."ref_type" IN ('opening', 'supplier_receipt', 'packing_slip', 'adjustment')),
	CONSTRAINT "chk_stock_moves_qty" CHECK ("stock_moves"."qty" <> 0)
);
--> statement-breakpoint
ALTER TABLE "stock_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "stock_warehouse_id" text;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stock_balances_warehouse" ON "stock_balances" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_moves_ref" ON "stock_moves" USING btree ("ref_type","ref_id","sku","warehouse_id","kind");--> statement-breakpoint
CREATE INDEX "idx_stock_moves_card" ON "stock_moves" USING btree ("sku","warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_moves_warehouse" ON "stock_moves" USING btree ("warehouse_id","created_at");