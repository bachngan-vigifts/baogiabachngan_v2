ALTER TABLE "staff_members" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "approved_at" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "approved_at" text;--> statement-breakpoint
CREATE INDEX "idx_sapo_customers_approval" ON "sapo_customers" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "idx_products_approval" ON "products" USING btree ("approval_status");--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD CONSTRAINT "chk_sapo_customers_approval" CHECK ("sapo_customers"."approval_status" IN ('pending', 'approved'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "chk_products_approval" CHECK ("products"."approval_status" IN ('pending', 'approved'));