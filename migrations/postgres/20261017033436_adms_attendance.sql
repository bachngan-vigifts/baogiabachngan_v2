-- Lượt máy độc lập hr_attendance / lương. Sinh bằng drizzle-kit; không lặp lại migration tồn kho đã có.
CREATE TABLE "hr_adms_logs" (
	"company_id" integer NOT NULL,
	"log_id" text NOT NULL,
	"emp_code" text NOT NULL,
	"full_name" text NOT NULL,
	"check_time" text NOT NULL,
	"punch_state" integer NOT NULL,
	"device_serial" text NOT NULL,
	"source" text NOT NULL,
	"imported_at" text NOT NULL,
	CONSTRAINT "hr_adms_logs_company_id_log_id_pk" PRIMARY KEY("company_id","log_id")
);
--> statement-breakpoint
ALTER TABLE "hr_adms_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_adms_members" (
	"company_id" integer NOT NULL,
	"emp_code" text NOT NULL,
	"member_id" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "hr_adms_members_company_id_emp_code_pk" PRIMARY KEY("company_id","emp_code")
);
--> statement-breakpoint
ALTER TABLE "hr_adms_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_adms_sync_state" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"synced_at" text NOT NULL,
	"synced_by" text NOT NULL,
	"fetched" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_adms_sync_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_adms_members" ADD CONSTRAINT "hr_adms_members_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_adms_members" ADD CONSTRAINT "hr_adms_members_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_adms_sync_state" ADD CONSTRAINT "hr_adms_sync_state_synced_by_staff_members_id_fk" FOREIGN KEY ("synced_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_adms_company_time" ON "hr_adms_logs" USING btree ("company_id","check_time","log_id");--> statement-breakpoint
CREATE INDEX "idx_adms_employee_time" ON "hr_adms_logs" USING btree ("company_id","emp_code","check_time");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_adms_member_company" ON "hr_adms_members" USING btree ("company_id","member_id");
