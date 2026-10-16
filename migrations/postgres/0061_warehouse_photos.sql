CREATE TABLE "warehouse_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"file_key" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_warehouse_photos_ref_type" CHECK ("warehouse_photos"."ref_type" IN ('supplier_receipt', 'delivery'))
);
--> statement-breakpoint
ALTER TABLE "warehouse_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouse_photos" ADD CONSTRAINT "warehouse_photos_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_warehouse_photos_ref" ON "warehouse_photos" USING btree ("ref_type","ref_id");