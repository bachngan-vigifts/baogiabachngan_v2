-- Tệp đính kèm báo cáo Cửa hàng trưởng (chứng từ nộp tiền, biên bản kiểm kê). Chỉ thêm bảng mới. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.store_report_files (
 id text PRIMARY KEY,
 register_id text NOT NULL REFERENCES public.pos_registers(id),
 kind text NOT NULL CONSTRAINT chk_store_report_files_kind CHECK (kind IN ('daily','weekly','monthly','stocktake')),
 period text NOT NULL,
 purpose text NOT NULL CONSTRAINT chk_store_report_files_purpose CHECK (purpose IN ('bank_deposit','stocktake_record','other')),
 file_key text NOT NULL,
 name text NOT NULL,
 mime text NOT NULL CONSTRAINT chk_store_report_files_mime CHECK (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes integer NOT NULL CONSTRAINT chk_store_report_files_bytes CHECK (bytes > 0 and bytes <= 6291456),
 sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CONSTRAINT chk_store_report_files_status CHECK (status IN ('uploading','ready','deleted')),
 created_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,
 deleted_by text REFERENCES public.staff_members(id),
 deleted_at text,
 purged_at text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_report_files_key ON public.store_report_files(file_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_store_report_files_slot ON public.store_report_files(register_id, kind, period, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_store_report_files_cleanup ON public.store_report_files(status, created_at);
--> statement-breakpoint
ALTER TABLE public.store_report_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 REVOKE ALL ON public.store_report_files FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.store_report_files FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.store_report_files FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.store_report_files TO service_role; END IF;
END $$;
