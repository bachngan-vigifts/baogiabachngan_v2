ALTER TABLE "incoming_shipments" ADD COLUMN IF NOT EXISTS "submitted_at" text;--> statement-breakpoint
-- Đơn mua đã có trước bản này coi như đã gửi duyệt (giữ nguyên hàng chờ duyệt hiện tại của Manager).
UPDATE "incoming_shipments" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;
