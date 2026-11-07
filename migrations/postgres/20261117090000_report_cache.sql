-- Bản tính sẵn của trang Tổng quan / Phân tích lợi nhuận (hết hạn 30 phút, nút "Cập nhật" tính lại). Chỉ thêm bảng mới.
-- Chỉ là bản sao số liệu: xoá dữ liệu bảng bất kỳ lúc nào cũng an toàn. Chạy tay trước khi triển khai API. Chạy lại không đổi gì.
CREATE TABLE IF NOT EXISTS public.report_cache (
 key text PRIMARY KEY,
 scope text NOT NULL,
 data text NOT NULL,
 computed_at text NOT NULL,
 computed_by text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_report_cache_scope ON public.report_cache (scope, computed_at);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE public.report_cache ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.report_cache FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.report_cache FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.report_cache FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.report_cache TO service_role; END IF;
END $$;
