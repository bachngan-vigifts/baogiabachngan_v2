CREATE TABLE "cash_drawers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"approval_threshold" double precision DEFAULT 1000000 NOT NULL,
	"opening_amount" double precision,
	"opening_reason" text DEFAULT '' NOT NULL,
	"opening_set_at" text,
	"opening_set_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	CONSTRAINT "chk_cash_threshold" CHECK ("cash_drawers"."approval_threshold">0 and "cash_drawers"."approval_threshold"=trunc("cash_drawers"."approval_threshold") and "cash_drawers"."approval_threshold"<=1000000000000),
	CONSTRAINT "chk_cash_opening" CHECK ("cash_drawers"."opening_amount" is null or ("cash_drawers"."opening_amount">=0 and "cash_drawers"."opening_amount"=trunc("cash_drawers"."opening_amount") and "cash_drawers"."opening_amount"<=1000000000000))
);
--> statement-breakpoint
ALTER TABLE "cash_drawers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_no" text NOT NULL,
	"drawer_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"amount" double precision NOT NULL,
	"reason" text NOT NULL,
	"photo_file_key" text,
	"status" text NOT NULL,
	"approval_threshold_snapshot" double precision NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"approved_by" text,
	"approved_at" text,
	"voided_by" text,
	"voided_at" text,
	"void_reason" text DEFAULT '' NOT NULL,
	"reconciliation_id" text,
	"request_key" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_cash_entry_amount" CHECK ("cash_entries"."amount">0 and "cash_entries"."amount"=trunc("cash_entries"."amount") and "cash_entries"."amount"<=1000000000000),
	CONSTRAINT "chk_cash_entry_status" CHECK ("cash_entries"."status" in ('pending','posted','voided')),
	CONSTRAINT "chk_cash_entry_direction" CHECK (("cash_entries"."kind" in ('other_income','cash_in') and "cash_entries"."direction"='in') or ("cash_entries"."kind" in ('petty_expense','advance','cash_out') and "cash_entries"."direction"='out') or ("cash_entries"."kind"='adjustment' and "cash_entries"."direction" in ('in','out'))),
	CONSTRAINT "chk_cash_approval_actor" CHECK ("cash_entries"."approved_by" is null or "cash_entries"."approved_by"<>"cash_entries"."created_by"),
	CONSTRAINT "chk_cash_void_reason" CHECK ("cash_entries"."status"<>'voided' or ("cash_entries"."voided_at" is not null and length(trim("cash_entries"."void_reason"))>0))
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"reconciliation_no" text NOT NULL,
	"drawer_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"closed_by" text NOT NULL,
	"expected_cash" double precision NOT NULL,
	"counted_cash" double precision NOT NULL,
	"difference" double precision NOT NULL,
	"reason_code" text NOT NULL,
	"reason_note" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"explained_by" text,
	"explained_at" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"close_reason" text DEFAULT '' NOT NULL,
	"resolved_by" text,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_cash_reconciliation_status" CHECK ("cash_reconciliations"."status" in ('pending','explained','closed'))
);
--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD COLUMN "cash_drawer_id" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "cash_drawer_id" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "previous_shift_id" text;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_reason_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_reason_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
INSERT INTO "cash_drawers" ("id", "name", "updated_at") VALUES ('store', 'Két cửa hàng', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_opening_set_by_staff_members_id_fk" FOREIGN KEY ("opening_set_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_drawer_id_cash_drawers_id_fk" FOREIGN KEY ("drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_approved_by_staff_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_voided_by_staff_members_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reconciliation_id_cash_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."cash_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_drawer_id_cash_drawers_id_fk" FOREIGN KEY ("drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_closed_by_staff_members_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_explained_by_staff_members_id_fk" FOREIGN KEY ("explained_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_resolved_by_staff_members_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_entry_key" ON "cash_entries" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_entry_no" ON "cash_entries" USING btree ("entry_no");--> statement-breakpoint
CREATE INDEX "idx_cash_entry_shift" ON "cash_entries" USING btree ("shift_id","status");--> statement-breakpoint
CREATE INDEX "idx_cash_entry_date" ON "cash_entries" USING btree ("drawer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_reconciliation_shift" ON "cash_reconciliations" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_reconciliation_no" ON "cash_reconciliations" USING btree ("reconciliation_no");--> statement-breakpoint
CREATE INDEX "idx_cash_reconciliation_status" ON "cash_reconciliations" USING btree ("drawer_id","status","created_at");--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_cash_drawer_id_cash_drawers_id_fk" FOREIGN KEY ("cash_drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_cash_drawer_id_cash_drawers_id_fk" FOREIGN KEY ("cash_drawer_id") REFERENCES "public"."cash_drawers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_drawer_open_shift" ON "pos_shifts" USING btree ("cash_drawer_id") WHERE "pos_shifts"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_shift_successor" ON "pos_shifts" USING btree ("previous_shift_id");
INSERT INTO "staff_position_permissions" ("position_id", "permission")
SELECT s.id, p.permission FROM "staff_positions" s CROSS JOIN (VALUES ('page.cash')) p(permission)
WHERE s.id IN ('sale','sale-admin','sales-ml','sales-lock','accounting') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "staff_position_permissions" ("position_id", "permission") SELECT id, 'cash.view-all' FROM "staff_positions" WHERE id='accounting' ON CONFLICT DO NOTHING;
