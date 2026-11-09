-- Additive, repeatable; no receipt/payment backfill or edits to existing migrations.
ALTER TABLE "web_store_orders" ADD COLUMN IF NOT EXISTS "ordered_at_verified" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD COLUMN IF NOT EXISTS "match_method" text NOT NULL DEFAULT 'reference';
--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD COLUMN IF NOT EXISTS "matched_order_at" text;
--> statement-breakpoint
DO $check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_transactions'::regclass AND conname='chk_sepay_match_method') THEN
  ALTER TABLE "sepay_transactions" ADD CONSTRAINT "chk_sepay_match_method" CHECK ("match_method" IN ('reference','amount_time','manual'));
 END IF;
END $check$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sepay_pending_time" ON "sepay_transactions" ("transaction_at", "id")
 WHERE "status" IN ('review','unmatched') AND "payment_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sepay_payment_link" ON "sepay_transactions" ("payment_id") WHERE "payment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_orders_created" ON "sales_orders" ("created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_web_orders_created" ON "web_store_orders" ("ordered_at");
