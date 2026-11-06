DO $$ BEGIN
 IF to_regclass('public.hr_revenue_target_requests') IS NULL THEN RAISE EXCEPTION 'Apply hr_revenue_target_requests migration before API deployment'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.hr_revenue_target_requests'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Revenue target requests require RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_hr_revenue_request_pending') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Revenue target requests require one pending request per employee/year'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (has_table_privilege(rolname,'public.hr_revenue_target_requests','SELECT') OR has_table_privilege(rolname,'public.hr_revenue_target_requests','INSERT') OR has_table_privilege(rolname,'public.hr_revenue_target_requests','UPDATE') OR has_table_privilege(rolname,'public.hr_revenue_target_requests','DELETE'))) THEN RAISE EXCEPTION 'Revenue target requests must remain backend-only'; END IF;
END $$;
