CREATE TABLE "packing_slip_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"slip_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"qty" double precision NOT NULL,
	"per_carton" double precision,
	"carton_weight" double precision,
	"carton_size" text DEFAULT '' NOT NULL,
	"weight" double precision,
	CONSTRAINT "chk_packing_slip_lines_qty" CHECK ("packing_slip_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "packing_slip_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "packing_slip_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"slip_id" text NOT NULL,
	"data_url" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packing_slip_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "packing_slips" (
	"id" text PRIMARY KEY NOT NULL,
	"slip_no" text NOT NULL,
	"order_id" text NOT NULL,
	"source" text DEFAULT 'warehouse' NOT NULL,
	"source_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"total_qty" double precision DEFAULT 0 NOT NULL,
	"total_weight" double precision,
	"created_by" text NOT NULL,
	"sent_at" text,
	"sent_by" text,
	"packed_at" text,
	"packed_by" text,
	"packed_note" text DEFAULT '' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_packing_slips_status" CHECK ("packing_slips"."status" IN ('draft', 'sent', 'packed', 'cancelled')),
	CONSTRAINT "chk_packing_slips_source" CHECK ("packing_slips"."source" IN ('warehouse', 'store', 'supplier', 'agent', 'other')),
	CONSTRAINT "chk_packing_slips_qty" CHECK ("packing_slips"."total_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "packing_slips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "packing_slip_lines" ADD CONSTRAINT "packing_slip_lines_slip_id_packing_slips_id_fk" FOREIGN KEY ("slip_id") REFERENCES "public"."packing_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slip_lines" ADD CONSTRAINT "packing_slip_lines_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slip_photos" ADD CONSTRAINT "packing_slip_photos_slip_id_packing_slips_id_fk" FOREIGN KEY ("slip_id") REFERENCES "public"."packing_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slip_photos" ADD CONSTRAINT "packing_slip_photos_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_sent_by_staff_members_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_packed_by_staff_members_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_packing_slip_lines_slip" ON "packing_slip_lines" USING btree ("slip_id");--> statement-breakpoint
CREATE INDEX "idx_packing_slip_lines_order_line" ON "packing_slip_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "idx_packing_slip_photos_slip" ON "packing_slip_photos" USING btree ("slip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_packing_slips_no" ON "packing_slips" USING btree ("slip_no");--> statement-breakpoint
CREATE INDEX "idx_packing_slips_order" ON "packing_slips" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_packing_slips_status" ON "packing_slips" USING btree ("status","updated_at");