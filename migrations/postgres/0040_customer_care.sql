CREATE TABLE "customer_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"result" text DEFAULT 'none' NOT NULL,
	"occurred_at" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"next_at" text,
	"next_action" text DEFAULT '' NOT NULL,
	"next_done_at" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_customer_activities_type" CHECK ("customer_activities"."type" IN ('call', 'zalo', 'meeting', 'visit', 'email', 'sms', 'note')),
	CONSTRAINT "chk_customer_activities_result" CHECK ("customer_activities"."result" IN ('none', 'interested', 'quote_requested', 'ordered', 'follow_up', 'no_answer', 'not_interested', 'complaint')),
	CONSTRAINT "chk_customer_activities_text" CHECK (length(trim("customer_activities"."subject")) > 0 OR length(trim("customer_activities"."content")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "chk_tasks_source";--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_owner_id_staff_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_activities_owner" ON "customer_activities" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_customer_activities_customer" ON "customer_activities" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_customer_activities_follow_up" ON "customer_activities" USING btree ("owner_id","next_at") WHERE "customer_activities"."next_at" IS NOT NULL AND "customer_activities"."next_done_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "chk_tasks_source" CHECK ("tasks"."source" IN ('manual', 'quote', 'stock_request', 'order', 'delivery', 'packing', 'contract', 'receivable', 'purchase', 'invoice', 'care'));