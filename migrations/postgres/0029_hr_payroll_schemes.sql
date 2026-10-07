CREATE TABLE "hr_month_inputs" (
	"member_id" text NOT NULL,
	"month" text NOT NULL,
	"data" text DEFAULT '{}' NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "hr_month_inputs_member_id_month_pk" PRIMARY KEY("member_id","month"),
	CONSTRAINT "chk_hr_month_inputs_month" CHECK ("hr_month_inputs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "hr_month_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "scheme" text DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD COLUMN "lines" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "scheme" text DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD COLUMN "params" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_month_inputs" ADD CONSTRAINT "hr_month_inputs_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_month_inputs" ADD CONSTRAINT "hr_month_inputs_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "chk_hr_payslips_scheme" CHECK ("hr_payslips"."scheme" IN ('basic', 'sale', 'bachngan', 'lock'));--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "chk_hr_salary_scheme" CHECK ("hr_salary_profiles"."scheme" IN ('basic', 'sale', 'bachngan', 'lock'));