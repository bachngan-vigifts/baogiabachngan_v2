-- Read-only gate: run 20261112100000_store_report_files.sql manually before deploying the API.
DO $$ BEGIN
 IF to_regclass('public.store_report_files') IS NULL THEN RAISE EXCEPTION 'Run 20261112100000_store_report_files.sql manually before deploying this API'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.store_report_files') AND relrowsecurity) THEN RAISE EXCEPTION 'store_report_files requires RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_store_report_files_key') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'store_report_files requires unique file_key'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_store_report_files_bytes') THEN RAISE EXCEPTION 'store_report_files requires the 6 MB size check'; END IF;
END $$;
