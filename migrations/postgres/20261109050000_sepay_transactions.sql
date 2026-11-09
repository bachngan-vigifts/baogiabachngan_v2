CREATE TABLE "sepay_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "provider_id" text NOT NULL,
  "transfer_type" text NOT NULL,
  "amount" double precision NOT NULL,
  "account_number" text DEFAULT '' NOT NULL,
  "transaction_at" text NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "status" text NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "order_id" text,
  "payment_id" text,
  "payload" text NOT NULL,
  "received_at" text NOT NULL,
  CONSTRAINT "chk_sepay_transactions_status" CHECK ("status" in ('matched','unmatched','review'))
);
CREATE UNIQUE INDEX "uq_sepay_transactions_provider" ON "sepay_transactions" USING btree ("provider_id");
CREATE INDEX "idx_sepay_transactions_status_received" ON "sepay_transactions" USING btree ("status","received_at");
ALTER TABLE "sepay_transactions" ENABLE ROW LEVEL SECURITY;
