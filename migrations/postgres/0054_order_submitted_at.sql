ALTER TABLE "sales_orders" ADD COLUMN "submitted_at" text;--> statement-breakpoint
-- Đơn / HĐKT có từ trước giữ nguyên hành vi cũ: coi như đã gửi duyệt.
UPDATE "sales_orders" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;
