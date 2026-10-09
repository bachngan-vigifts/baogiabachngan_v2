CREATE TABLE "order_progress_marks" (
	"order_id" text NOT NULL,
	"stage" text NOT NULL,
	"source" text NOT NULL,
	"marked_by" text,
	"marked_at" text NOT NULL,
	CONSTRAINT "order_progress_marks_order_id_stage_pk" PRIMARY KEY("order_id","stage"),
	CONSTRAINT "chk_order_progress_stage" CHECK ("order_progress_marks"."stage" IN ('approve', 'export', 'sample', 'production', 'delivered')),
	CONSTRAINT "chk_order_progress_source" CHECK ("order_progress_marks"."source" IN ('task', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "order_progress_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_progress_marks" ADD CONSTRAINT "order_progress_marks_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_progress_marks" ADD CONSTRAINT "order_progress_marks_marked_by_staff_members_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;