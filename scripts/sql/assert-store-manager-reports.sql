-- Read-only gate: run 20261111100000_store_manager_reports.sql manually before deploying the API.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['store_managers','store_reports'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Run 20261111100000_store_manager_reports.sql manually before deploying this API (missing %)', tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Store manager reports require RLS on %', tbl; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_store_reports_period') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Store reports require one report per store/kind/period'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_store_managers_member') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Store managers require one store per member'; END IF;
END $$;
