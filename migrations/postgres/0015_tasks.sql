CREATE TABLE "task_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"link" text DEFAULT '' NOT NULL,
	"auto_key" text,
	"assignee_id" text,
	"created_by" text,
	"due_date" text,
	"due_time" text,
	"started_at" text,
	"completed_at" text,
	"completed_by" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_tasks_status" CHECK ("tasks"."status" IN ('todo', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "chk_tasks_priority" CHECK ("tasks"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "chk_tasks_source" CHECK ("tasks"."source" IN ('manual', 'quote', 'stock_request', 'order', 'delivery', 'contract', 'receivable', 'purchase'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_staff_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_staff_members_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_comments_task" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_auto_key" ON "tasks" USING btree ("auto_key");--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee" ON "tasks" USING btree ("assignee_id","status","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_creator" ON "tasks" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_status_due" ON "tasks" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_source" ON "tasks" USING btree ("source","source_id");