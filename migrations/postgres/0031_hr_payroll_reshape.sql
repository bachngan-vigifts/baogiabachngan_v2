DROP TABLE "hr_month_inputs" CASCADE;--> statement-breakpoint
ALTER TABLE "hr_adjustments" DROP CONSTRAINT "chk_hr_adjustments_kind";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP CONSTRAINT "chk_hr_payslips_scheme";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP CONSTRAINT "chk_hr_salary_scheme";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP CONSTRAINT "chk_hr_salary_rates";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP CONSTRAINT "chk_hr_salary_money";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "standard_days";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "worked_days";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "base_salary";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "salary_by_days";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "allowance";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "revenue";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "commission_rate";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "commission";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "bonus";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "extra_allowance";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "deduction";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "advance";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "insurance";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "scheme";--> statement-breakpoint
ALTER TABLE "hr_payslips" DROP COLUMN "lines";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP COLUMN "allowance";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP COLUMN "standard_days";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP COLUMN "commission_rate";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP COLUMN "scheme";--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" DROP COLUMN "params";--> statement-breakpoint
ALTER TABLE "hr_adjustments" ADD CONSTRAINT "chk_hr_adjustments_kind" CHECK ("hr_adjustments"."kind" IN ('bonus', 'allowance', 'deduction', 'advance', 'phone_advance'));--> statement-breakpoint
ALTER TABLE "hr_salary_profiles" ADD CONSTRAINT "chk_hr_salary_money" CHECK ("hr_salary_profiles"."base_salary" >= 0 AND "hr_salary_profiles"."revenue_target" >= 0 AND "hr_salary_profiles"."insurance" >= 0);