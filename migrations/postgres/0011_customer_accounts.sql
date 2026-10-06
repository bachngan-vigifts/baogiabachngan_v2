CREATE TABLE "customer_accounts" (
	"member_id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"discounts" text DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_owner_id_staff_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_accounts_customer" ON "customer_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_customer_accounts_owner" ON "customer_accounts" USING btree ("owner_id");--> statement-breakpoint
-- Chức vụ "Khách hàng": tài khoản trang khách hàng (vai trò 'customer'), không phải nhân viên.
INSERT INTO "staff_positions" ("id", "name") VALUES ('customer', 'Khách hàng') ON CONFLICT ("id") DO NOTHING;
