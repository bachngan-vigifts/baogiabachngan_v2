ALTER TABLE "sepay_transactions" ADD COLUMN IF NOT EXISTS "web_order_id" text;
--> statement-breakpoint
DO $check$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_transactions'::regclass AND conname='chk_sepay_one_target') THEN
  ALTER TABLE "sepay_transactions" ADD CONSTRAINT "chk_sepay_one_target" CHECK (web_order_id IS NULL OR (order_id IS NULL AND payment_id IS NULL));
 END IF;
END
$check$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sepay_web_matched" ON "sepay_transactions" ("web_order_id") WHERE "web_order_id" IS NOT NULL AND "status"='matched';
