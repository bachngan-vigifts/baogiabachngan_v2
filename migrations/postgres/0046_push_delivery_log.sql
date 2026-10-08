CREATE TABLE "web_push_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"event_type" text NOT NULL,
	"member_id" text,
	"subscription_id" text,
	"status" integer,
	"error" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_push_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_web_push_subscriptions" ADD COLUMN "last_status" integer;--> statement-breakpoint
ALTER TABLE "staff_web_push_subscriptions" ADD COLUMN "last_error" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_web_push_subscriptions" ADD COLUMN "last_attempt_at" text;--> statement-breakpoint
ALTER TABLE "staff_web_push_subscriptions" ADD COLUMN "last_ok_at" text;--> statement-breakpoint
CREATE INDEX "idx_web_push_attempts_created" ON "web_push_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_web_push_attempts_member" ON "web_push_attempts" USING btree ("member_id","created_at");