-- Báo cáo tháng của Sale / Sale Admin dùng chung bảng báo cáo tuần: kỳ tháng 'YYYY-MM' bên cạnh kỳ tuần 'YYYY-MM-DD'.
-- Chỉ nới ràng buộc định dạng kỳ; dữ liệu cũ (kỳ tuần) vẫn hợp lệ. Chạy tay sau 20261113090000_staff_weekly_reports.sql; chạy lại không đổi gì.
ALTER TABLE public.staff_weekly_reports DROP CONSTRAINT IF EXISTS chk_staff_weekly_reports_period;
--> statement-breakpoint
ALTER TABLE public.staff_weekly_reports ADD CONSTRAINT chk_staff_weekly_reports_period CHECK (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$');
