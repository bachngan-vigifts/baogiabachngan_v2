-- Báo cáo tuần của Sale / Sale Admin (căn cứ Tiền trách nhiệm từ tháng 12/2026): báo cáo nộp chính thức, nháp, lịch sử nộp.
-- Chỉ thêm bảng mới. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.staff_weekly_reports (
 id text PRIMARY KEY,
 member_id text NOT NULL REFERENCES public.staff_members(id),
 period text NOT NULL CONSTRAINT chk_staff_weekly_reports_period CHECK (period ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 data text NOT NULL,
 submitted_at text NOT NULL,
 updated_at text NOT NULL,
 client_key text NOT NULL,
 review text NOT NULL DEFAULT 'pending' CONSTRAINT chk_staff_weekly_reports_review CHECK (review IN ('pending','ok','rejected','excused')),
 review_note text NOT NULL DEFAULT '',
 reviewed_by text REFERENCES public.staff_members(id),
 reviewed_at text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_weekly_reports_period ON public.staff_weekly_reports(member_id, period);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_weekly_reports_client_key ON public.staff_weekly_reports(member_id, client_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_staff_weekly_reports_review ON public.staff_weekly_reports(review, period);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.staff_weekly_report_drafts (
 member_id text NOT NULL REFERENCES public.staff_members(id),
 period text NOT NULL,
 inputs text NOT NULL,
 updated_at text NOT NULL,
 CONSTRAINT staff_weekly_report_drafts_pkey PRIMARY KEY (member_id, period)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.staff_weekly_report_versions (
 id text PRIMARY KEY,
 report_id text NOT NULL REFERENCES public.staff_weekly_reports(id),
 version integer NOT NULL CONSTRAINT chk_staff_weekly_report_versions_version CHECK (version >= 1),
 data text NOT NULL,
 submitted_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_weekly_report_versions ON public.staff_weekly_report_versions(report_id, version);
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['staff_weekly_reports','staff_weekly_report_drafts','staff_weekly_report_versions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', tbl); END IF;
 END LOOP;
END $$;
