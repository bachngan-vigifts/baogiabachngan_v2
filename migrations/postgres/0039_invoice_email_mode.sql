ALTER TABLE "sales_orders" ADD COLUMN "invoice_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_mode" text DEFAULT 'issue' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "chk_sales_orders_invoice_mode" CHECK ("sales_orders"."invoice_mode" IN ('issue', 'draft'));