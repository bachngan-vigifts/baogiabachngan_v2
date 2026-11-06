CREATE TABLE "hr_revenue_target_requests" (
 "id" text PRIMARY KEY,
 "member_id" text NOT NULL REFERENCES "staff_members"("id"),
 "year" text NOT NULL,
 "changes" jsonb NOT NULL,
 "reason" text NOT NULL,
 "status" text NOT NULL DEFAULT 'pending',
 "revision" integer NOT NULL DEFAULT 1,
 "submitted_at" text NOT NULL,
 "resolved_by" text REFERENCES "staff_members"("id"),
 "resolved_at" text,
 "resolution_note" text NOT NULL DEFAULT '',
 CONSTRAINT "chk_hr_revenue_request_year" CHECK ("year" ~ '^[0-9]{4}$' AND "year">='2000' AND "year"<='2100'),
 CONSTRAINT "chk_hr_revenue_request_changes" CHECK (jsonb_typeof("changes")='array' AND jsonb_array_length("changes") BETWEEN 1 AND 12),
 CONSTRAINT "chk_hr_revenue_request_reason" CHECK (length(btrim("reason")) BETWEEN 3 AND 500),
 CONSTRAINT "chk_hr_revenue_request_revision" CHECK ("revision">0),
 CONSTRAINT "chk_hr_revenue_request_status" CHECK ("status" IN ('pending','approved','rejected','withdrawn')),
 CONSTRAINT "chk_hr_revenue_request_resolution" CHECK (("status"='pending' AND "resolved_by" IS NULL AND "resolved_at" IS NULL) OR ("status"<>'pending' AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)),
 CONSTRAINT "chk_hr_revenue_request_note" CHECK (length("resolution_note")<=500 AND ("status"<>'rejected' OR length(btrim("resolution_note"))>=3))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_revenue_request_pending" ON "hr_revenue_target_requests" ("member_id","year") WHERE "status"='pending';
--> statement-breakpoint
CREATE INDEX "idx_hr_revenue_requests_member_year" ON "hr_revenue_target_requests" ("member_id","year","submitted_at");
--> statement-breakpoint
CREATE INDEX "idx_hr_revenue_requests_queue" ON "hr_revenue_target_requests" ("year","status","submitted_at");
--> statement-breakpoint
CREATE INDEX "idx_hr_revenue_requests_resolver" ON "hr_revenue_target_requests" ("resolved_by");
--> statement-breakpoint
ALTER TABLE "hr_revenue_target_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "hr_revenue_target_requests" FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "hr_revenue_target_requests" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "hr_revenue_target_requests" FROM authenticated; END IF;
END $$;
