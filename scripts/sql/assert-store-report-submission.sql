-- Read-only gate: run 20261112090000_store_report_submission.sql manually before deploying the API.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['store_report_drafts','store_report_versions','store_settings'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Run 20261112090000_store_report_submission.sql manually before deploying this API (missing %)', tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Store report submission requires RLS on %', tbl; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_store_report_versions') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Store report versions require unique (report_id, version)'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_reports r WHERE NOT EXISTS(SELECT 1 FROM public.store_report_versions v WHERE v.report_id=r.id)) THEN RAISE EXCEPTION 'Every submitted store report requires a version 1 snapshot'; END IF;
END $$;
