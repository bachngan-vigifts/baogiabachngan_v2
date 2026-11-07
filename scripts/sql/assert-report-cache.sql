-- Read-only gate: run 20261117090000_report_cache.sql manually before deploying the API (dashboard / profit pages cache their results).
DO $$ BEGIN
 IF to_regclass('public.report_cache') IS NULL THEN RAISE EXCEPTION 'Run 20261117090000_report_cache.sql manually before deploying this API (missing report_cache)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.report_cache') AND relrowsecurity) THEN RAISE EXCEPTION 'report_cache requires RLS'; END IF;
END $$;
