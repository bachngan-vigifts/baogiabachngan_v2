CREATE TABLE "hr_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_hr_adjustments_kind" CHECK ("hr_adjustments"."kind" IN ('bonus', 'allowance', 'deduction', 'advance')),
	CONSTRAINT "chk_hr_adjustments_amount" CHECK ("hr_adjustments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "hr_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_attendance" (
	"member_id" text NOT NULL,
	"work_date" text NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "hr_attendance_member_id_work_date_pk" PRIMARY KEY("member_id","work_date"),
	CONSTRAINT "chk_hr_attendance_status" CHECK ("hr_attendance"."status" IN ('present', 'half', 'paid_leave', 'unpaid_leave', 'absent'))
);
--> statement-breakpoint
ALTER TABLE "hr_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_payslips" (
	"member_id" text NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"standard_days" double precision NOT NULL,
	"worked_days" double precision NOT NULL,
	"base_salary" double precision NOT NULL,
	"salary_by_days" double precision NOT NULL,
	"allowance" double precision NOT NULL,
	"revenue" double precision NOT NULL,
	"commission_rate" double precision NOT NULL,
	"commission" double precision NOT NULL,
	"bonus" double precision NOT NULL,
	"extra_allowance" double precision NOT NULL,
	"deduction" double precision NOT NULL,
	"advance" double precision NOT NULL,
	"insurance" double precision NOT NULL,
	"gross" double precision NOT NULL,
	"net" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" text NOT NULL,
	"paid_at" text,
	CONSTRAINT "hr_payslips_member_id_month_pk" PRIMARY KEY("member_id","month"),
	CONSTRAINT "chk_hr_payslips_status" CHECK ("hr_payslips"."status" IN ('confirmed', 'paid'))
);
--> statement-breakpoint
ALTER TABLE "hr_payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_salary_profiles" (
	"member_id" text NOT NULL,
	"effective_month" text NOT NULL,
	"base_salary" double precision DEFAULT 0 NOT NULL,
	"allowance" double precision DEFAULT 0 NOT NULL,
	"standard_days" double precision DEFAULT 26 NOT NULL,
	"revenue_target" double precision DEFAULT 0 NOT NULL,
	"commission_rate" double precision DEFAULT 0 NOT NULL,
	"insurance" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "hr_salary_profiles_member_id_effective_month_pk" PRIMARY KEY("member_id","effective_month"),
	CONSTRAINT "chk_hr_salary_month" CHECK ("hr_salary_profiles"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "chk_hr_salary_money" CHECK ("hr_salary_profiles"."base_salary" >= 0 AND "hr_salary_profiles"."allowance" >= 0 AND "hr_salary_profiles"."revenue_target" >= 0 AND "hr_salary_profiles"."insurance" >= 0),
	CONSTRAINT "chk_hr_salary_rates" CHECK ("hr_salary_profiles"."standard_days" > 0 AND "hr_salary_profiles"."standard_days" <= 31 AND "hr_salary_profiles"."commission_rate" >= 0 AND "hr_salary_profiles"."commission_rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_adjustments" ADD CONSTRAINT "hr_adjustments_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_adjustments" ADD CONSTRAINT "hr_adjustments_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_recorded_by_staff_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_confirmed_by_staff_members_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "hr_salary_profiles_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "hr_salary_profiles_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_adjustments_member" ON "hr_adjustments" USING btree ("member_id","month");--> statement-breakpoint
CREATE INDEX "idx_hr_payslips_month" ON "hr_payslips" USING btree ("month","status");