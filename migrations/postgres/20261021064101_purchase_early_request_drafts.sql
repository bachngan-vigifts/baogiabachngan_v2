ALTER TABLE "purchase_early_requests"
 ADD COLUMN "status" text NOT NULL DEFAULT 'submitted',
 ADD COLUMN "pickup_date" text NOT NULL DEFAULT '',
 ADD COLUMN "scope" text NOT NULL DEFAULT '{}',
 ADD COLUMN "updated_at" text NOT NULL DEFAULT '',
 ADD COLUMN "revision" bigint NOT NULL DEFAULT 1,
 ADD CONSTRAINT "chk_purchase_early_request_status" CHECK ("status" IN ('draft','submitted'));
