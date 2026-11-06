-- Cửa hàng trưởng (CHT): gán CHT cho từng cửa hàng (quầy POS) + báo cáo ngày / tuần / tháng / kiểm tồn kho và kết quả duyệt.
-- Bảng mới, không đụng dữ liệu cũ. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.store_managers (
 register_id text PRIMARY KEY REFERENCES public.pos_registers(id),
 member_id text NOT NULL REFERENCES public.staff_members(id),
 assigned_by text NOT NULL REFERENCES public.staff_members(id),
 assigned_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_managers_member ON public.store_managers(member_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.store_reports (
 id text PRIMARY KEY,
 register_id text NOT NULL REFERENCES public.pos_registers(id),
 kind text NOT NULL CONSTRAINT chk_store_reports_kind CHECK (kind IN ('daily','weekly','monthly','stocktake')),
 period text NOT NULL CONSTRAINT chk_store_reports_period CHECK (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
 member_id text NOT NULL REFERENCES public.staff_members(id),
 data text NOT NULL,
 submitted_at text NOT NULL,
 updated_at text NOT NULL,
 client_key text NOT NULL,
 review text NOT NULL DEFAULT 'pending' CONSTRAINT chk_store_reports_review CHECK (review IN ('pending','ok','cash_error','order_error','gap_unreported','excused')),
 review_note text NOT NULL DEFAULT '',
 reviewed_by text REFERENCES public.staff_members(id),
 reviewed_at text,
 explanation text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_reports_period ON public.store_reports(register_id, kind, period);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_reports_client_key ON public.store_reports(member_id, client_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_store_reports_review ON public.store_reports(review, submitted_at);
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['store_managers','store_reports'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', tbl); END IF;
 END LOOP;
END $$;
