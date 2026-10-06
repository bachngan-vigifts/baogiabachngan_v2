ALTER TABLE "staff_quotations" ADD COLUMN "approval_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_quotations" ADD COLUMN "approved_at" text;--> statement-breakpoint
ALTER TABLE "staff_quotations" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "staff_quotations" ADD CONSTRAINT "staff_quotations_approved_by_staff_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quotations_approval" ON "staff_quotations" USING btree ("approval_status","updated_at");--> statement-breakpoint
ALTER TABLE "staff_quotations" ADD CONSTRAINT "chk_quotations_approval_status" CHECK ("staff_quotations"."approval_status" IN ('pending', 'approved'));--> statement-breakpoint
-- Báo giá chuyển từ web cũ: đã duyệt nếu dữ liệu cũ ghi approvalStatus "approved" hoặc đã có PDF lưu (pdfKey) – đúng hàm approvalStatus() bản cũ.
UPDATE "staff_quotations" SET "approval_status" = 'approved'
WHERE "data" LIKE '%"approvalStatus":"approved"%' OR "data" LIKE '%"pdfKey":"%';
