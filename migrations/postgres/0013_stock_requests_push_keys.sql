CREATE TABLE "web_push_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_push_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_stock_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"items" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer_items" text DEFAULT '[]' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"answered_by" text,
	"answered_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_stock_requests_status" CHECK ("customer_stock_requests"."status" IN ('open', 'answered'))
);
--> statement-breakpoint
ALTER TABLE "customer_stock_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_stock_requests" ADD CONSTRAINT "customer_stock_requests_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_requests" ADD CONSTRAINT "customer_stock_requests_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_requests" ADD CONSTRAINT "customer_stock_requests_owner_id_staff_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_requests" ADD CONSTRAINT "customer_stock_requests_answered_by_staff_members_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stock_requests_owner" ON "customer_stock_requests" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_requests_member" ON "customer_stock_requests" USING btree ("member_id","created_at");