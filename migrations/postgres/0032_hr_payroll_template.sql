CREATE TABLE "hr_payroll_inputs" (
	"member_id" text NOT NULL,
	"month" text NOT NULL,
	"work_days" double precision,
	"overtime_hours" double precision DEFAULT 0 NOT NULL,
	"revenue" double precision,
	"output_qty" double precision DEFAULT 0 NOT NULL,
	"kpi_new_customers" double precision,
	"kpi_transactions" double precision,
	"kpi_contracts" double precision,
	"kpi_revenue" double precision,
	"kpi_merch_days" double precision DEFAULT 0 NOT NULL,
	"kpi_trip_days" double precision DEFAULT 0 NOT NULL,
	"kpi_override" double precision,
	"health_insurance" double precision DEFAULT 0 NOT NULL,
	"income_tax" double precision DEFAULT 0 NOT NULL,
	"quarter_bonus" double precision,
	"note" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "hr_payroll_inputs_member_id_month_pk" PRIMARY KEY("member_id","month"),
	CONSTRAINT "chk_hr_inputs_month" CHECK ("hr_payroll_inputs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "chk_hr_inputs_values" CHECK (coalesce("hr_payroll_inputs"."work_days", 0) >= 0 AND "hr_payroll_inputs"."overtime_hours" >= 0 AND coalesce("hr_payroll_inputs"."revenue", 0) >= 0 AND "hr_payroll_inputs"."output_qty" >= 0 AND "hr_payroll_inputs"."health_insurance" >= 0 AND "hr_payroll_inputs"."income_tax" >= 0 AND coalesce("hr_payroll_inputs"."quarter_bonus", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "hr_payroll_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_payroll_months" (
	"month" text PRIMARY KEY NOT NULL,
	"bn_revenue" double precision DEFAULT 0 NOT NULL,
	"bn_avg_revenue" double precision DEFAULT 0 NOT NULL,
	"lock_revenue" double precision DEFAULT 0 NOT NULL,
	"pay_quarter_bonus" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_hr_months_month" CHECK ("hr_payroll_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "chk_hr_months_money" CHECK ("hr_payroll_months"."bn_revenue" >= 0 AND "hr_payroll_months"."bn_avg_revenue" >= 0 AND "hr_payroll_months"."lock_revenue" >= 0)
);
--> statement-breakpoint
ALTER TABLE "hr_payroll_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_payroll_settings" (
	"effective_month" text PRIMARY KEY NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_hr_settings_month" CHECK ("hr_payroll_settings"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "hr_payroll_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "payroll_group" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "work_days" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "deduction_total" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "data" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "payroll_group" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "position_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "capacity_coef" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "responsibility_mode" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "responsibility" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "meal_allowance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "phone_allowance" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "attendance_bonus" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "kpi_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "team_bonus" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "output_rate" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "bank_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "bank_account" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "bank_holder" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payroll_inputs" ADD CONSTRAINT "hr_payroll_inputs_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_inputs" ADD CONSTRAINT "hr_payroll_inputs_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_months" ADD CONSTRAINT "hr_payroll_months_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_settings" ADD CONSTRAINT "hr_payroll_settings_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_inputs_month" ON "hr_payroll_inputs" USING btree ("month");--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "chk_hr_payslips_group" CHECK ("hr_payslips"."payroll_group" IN ('sale', 'bn', 'lock'));--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "chk_hr_salary_extra" CHECK ("hr_salary_profiles"."capacity_coef" >= 0 AND "hr_salary_profiles"."responsibility" >= 0 AND "hr_salary_profiles"."phone_allowance" >= 0 AND "hr_salary_profiles"."attendance_bonus" >= 0 AND "hr_salary_profiles"."output_rate" >= 0);--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "chk_hr_salary_group" CHECK ("hr_salary_profiles"."payroll_group" IN ('sale', 'bn', 'lock'));--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "chk_hr_salary_resp_mode" CHECK ("hr_salary_profiles"."responsibility_mode" IN ('fixed', 'prorated', 'per_day'));