-- Huỷ phiếu thu ghi nhầm: giữ dòng + lý do, không tính vào đã thu (docs/BAN-HANG.md "Công nợ").
ALTER TABLE "customer_payments" ADD COLUMN "voided_at" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "void_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_voided_by_staff_members_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Kế toán (yêu cầu 17/10/2026): bỏ Báo giá / Chăm sóc KH / Khách hỏi tồn; thêm Sổ thu / chi, Huỷ phiếu thu, Doanh số toàn công ty
-- (chỉ Kế toán – Sale Admin chỉ xem toàn công ty ở báo giá, khách, đơn, HĐKT; Manager cấp thêm ở trang Phân quyền nếu cần).
DELETE FROM "staff_position_permissions" WHERE "position_id" = 'accounting' AND "permission" IN ('page.quotes', 'page.care', 'page.stock-requests');--> statement-breakpoint
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES
  ('accounting', 'page.cashbook'), ('accounting', 'payments.void'), ('accounting', 'dashboard.all')
  ) AS v(position_id, permission) JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
