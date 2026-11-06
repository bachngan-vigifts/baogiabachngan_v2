-- Báo cáo Cửa hàng trưởng: nháp tách khỏi nộp chính thức, lịch sử mỗi lần nộp chính thức (bản chụp số liệu),
-- cấu hình báo cáo theo cửa hàng (quỹ giữ lại, lịch nộp tiền, ngưỡng giải trình kiểm tồn).
-- Chỉ thêm bảng mới; không sửa / xoá dữ liệu store_reports cũ. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.store_report_drafts (
 register_id text NOT NULL REFERENCES public.pos_registers(id),
 kind text NOT NULL CONSTRAINT chk_store_report_drafts_kind CHECK (kind IN ('daily','weekly','monthly','stocktake')),
 period text NOT NULL,
 member_id text NOT NULL REFERENCES public.staff_members(id),
 inputs text NOT NULL,
 updated_at text NOT NULL,
 CONSTRAINT store_report_drafts_pkey PRIMARY KEY (register_id, kind, period)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.store_report_versions (
 id text PRIMARY KEY,
 report_id text NOT NULL REFERENCES public.store_reports(id),
 version integer NOT NULL CONSTRAINT chk_store_report_versions_version CHECK (version >= 1),
 member_id text NOT NULL REFERENCES public.staff_members(id),
 data text NOT NULL,
 provisional boolean NOT NULL DEFAULT false,
 submitted_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_report_versions ON public.store_report_versions(report_id, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.store_settings (
 register_id text PRIMARY KEY REFERENCES public.pos_registers(id),
 cash_float double precision CONSTRAINT chk_store_settings_cash_float CHECK (cash_float is null or (cash_float >= 0 and cash_float = trunc(cash_float) and cash_float <= 100000000000)),
 deposit_schedule text CONSTRAINT chk_store_settings_schedule CHECK (deposit_schedule IN ('daily','periodic')),
 stocktake_explain_threshold double precision CONSTRAINT chk_store_settings_threshold CHECK (stocktake_explain_threshold is null or (stocktake_explain_threshold >= 0 and stocktake_explain_threshold <= 100000000000)),
 updated_by text NOT NULL REFERENCES public.staff_members(id),
 updated_at text NOT NULL
);
--> statement-breakpoint
-- Báo cáo đã nộp trước bản này: tạo lịch sử lần 1 từ chính dữ liệu đang lưu (không đổi giờ nộp, không tính lại số liệu).
INSERT INTO public.store_report_versions (id, report_id, version, member_id, data, provisional, submitted_at)
SELECT 'v1-' || r.id, r.id, 1, r.member_id, r.data, false, r.submitted_at FROM public.store_reports r
WHERE NOT EXISTS (SELECT 1 FROM public.store_report_versions v WHERE v.report_id = r.id);
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['store_report_drafts','store_report_versions','store_settings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', tbl); END IF;
 END LOOP;
END $$;
