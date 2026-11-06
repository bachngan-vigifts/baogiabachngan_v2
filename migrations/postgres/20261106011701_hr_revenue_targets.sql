CREATE TABLE "hr_revenue_targets" (
 "member_id" text NOT NULL REFERENCES "staff_members"("id"),
 "month" text NOT NULL,
 "amount" double precision NOT NULL,
 "updated_by" text REFERENCES "staff_members"("id"),
 "updated_at" text NOT NULL,
 PRIMARY KEY("member_id","month"),
 CONSTRAINT "chk_hr_revenue_target_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 CONSTRAINT "chk_hr_revenue_target_amount" CHECK ("amount">0 AND "amount"<=10000000000000 AND "amount"=floor("amount"))
);
--> statement-breakpoint
CREATE INDEX "idx_hr_revenue_targets_month" ON "hr_revenue_targets" ("month");
--> statement-breakpoint
ALTER TABLE "hr_revenue_targets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "hr_revenue_targets" FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON "hr_revenue_targets" FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON "hr_revenue_targets" FROM authenticated;
 END IF;
END $$;
