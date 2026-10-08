ALTER TABLE "customer_activities" DROP CONSTRAINT "chk_customer_activities_type";--> statement-breakpoint
ALTER TABLE "customer_activities" DROP CONSTRAINT "chk_customer_activities_result";--> statement-breakpoint
ALTER TABLE "customer_activities" ALTER COLUMN "result" SET DEFAULT 'consulting';--> statement-breakpoint
-- Chuyển danh mục cũ sang danh mục theo form CRM (bảng hiện chưa có dữ liệu thật; giữ an toàn nếu có).
UPDATE "customer_activities" SET "type" = CASE "type" WHEN 'visit' THEN 'meeting' WHEN 'sms' THEN 'zalo' WHEN 'note' THEN 'call' ELSE "type" END;--> statement-breakpoint
UPDATE "customer_activities" SET "result" = CASE "result" WHEN 'quote_requested' THEN 'quote_sent' WHEN 'ordered' THEN 'won' WHEN 'not_interested' THEN 'lost' ELSE 'consulting' END
  WHERE "result" NOT IN ('consulting', 'quote_sent', 'negotiating', 'won', 'lost');--> statement-breakpoint
ALTER TABLE "customer_activities" ADD COLUMN "expected_revenue" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_activities" ADD COLUMN "remind_before" text DEFAULT '1d' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "chk_customer_activities_remind" CHECK ("customer_activities"."remind_before" IN ('1d', '1w', '1m'));--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "chk_customer_activities_revenue" CHECK ("customer_activities"."expected_revenue" >= 0);--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "chk_customer_activities_type" CHECK ("customer_activities"."type" IN ('call', 'zalo', 'email', 'meeting', 'quote'));--> statement-breakpoint
ALTER TABLE "customer_activities" ADD CONSTRAINT "chk_customer_activities_result" CHECK ("customer_activities"."result" IN ('consulting', 'quote_sent', 'negotiating', 'won', 'lost'));