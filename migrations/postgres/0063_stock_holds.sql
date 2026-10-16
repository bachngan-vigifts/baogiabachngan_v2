CREATE TABLE "stock_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"sku" text NOT NULL,
	"qty" double precision NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"closed_at" text,
	"closed_by" text,
	"notified_at" text,
	CONSTRAINT "chk_stock_holds_status" CHECK ("stock_holds"."status" IN ('active', 'released', 'expired', 'converted')),
	CONSTRAINT "chk_stock_holds_qty" CHECK ("stock_holds"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_quote_id_staff_quotations_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."staff_quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_sku_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."products"("sku") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stock_holds_sku" ON "stock_holds" USING btree ("sku","status");--> statement-breakpoint
CREATE INDEX "idx_stock_holds_quote" ON "stock_holds" USING btree ("quote_id","status");--> statement-breakpoint
CREATE INDEX "idx_stock_holds_expiry" ON "stock_holds" USING btree ("status","expires_at");