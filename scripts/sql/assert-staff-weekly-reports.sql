-- Read-only gate: run 20261113090000_staff_weekly_reports.sql manually before deploying the API.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['staff_weekly_reports','staff_weekly_report_drafts','staff_weekly_report_versions'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Run 20261113090000_staff_weekly_reports.sql manually before deploying this API (missing %)', tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Staff weekly reports require RLS on %', tbl; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_staff_weekly_reports_period') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Staff weekly reports require one report per member/week'; END IF;
END $$;
