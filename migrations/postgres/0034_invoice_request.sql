ALTER TABLE "tasks" DROP CONSTRAINT "chk_tasks_source";--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_requested_at" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_requested_by" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_request_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_date" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_issued_at" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_issued_by" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_invoice_requested_by_staff_members_id_fk" FOREIGN KEY ("invoice_requested_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_invoice_issued_by_staff_members_id_fk" FOREIGN KEY ("invoice_issued_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sales_orders_invoice" ON "sales_orders" USING btree ("invoice_status") WHERE "sales_orders"."invoice_status" = 'requested';--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "chk_sales_orders_invoice_status" CHECK ("sales_orders"."invoice_status" IN ('none', 'requested', 'issued'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "chk_tasks_source" CHECK ("tasks"."source" IN ('manual', 'quote', 'stock_request', 'order', 'delivery', 'packing', 'contract', 'receivable', 'purchase', 'invoice'));