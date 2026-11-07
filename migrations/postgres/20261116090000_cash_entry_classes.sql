-- Loại phiếu két do Manager xác nhận / sửa (Phân tích lợi nhuận: chi phí chi nhánh). Chỉ thêm bảng mới.
-- Không có dòng nào thì vẫn tự phân loại theo loại phiếu + từ khoá như cũ. Chạy tay trước khi triển khai API. Chạy lại không đổi gì.
CREATE TABLE IF NOT EXISTS public.cash_entry_classes (
 entry_id text PRIMARY KEY REFERENCES public.cash_entries(id) ON DELETE CASCADE,
 cls text NOT NULL CONSTRAINT chk_cash_entry_classes_cls CHECK (cls IN ('operating','payroll','carrier','supplier','refund','advance','transfer','other_income','adjustment')),
 note text NOT NULL DEFAULT '',
 updated_by text REFERENCES public.staff_members(id),
 updated_at text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE public.cash_entry_classes ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.cash_entry_classes FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.cash_entry_classes FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.cash_entry_classes FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.cash_entry_classes TO service_role; END IF;
END $$;
