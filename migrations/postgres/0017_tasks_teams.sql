ALTER TABLE "tasks" DROP CONSTRAINT "chk_tasks_source";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_position" text;--> statement-breakpoint
CREATE INDEX "idx_tasks_team" ON "tasks" USING btree ("assignee_position","status");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "chk_tasks_source" CHECK ("tasks"."source" IN ('manual', 'quote', 'stock_request', 'order', 'delivery', 'packing', 'contract', 'receivable', 'purchase'));