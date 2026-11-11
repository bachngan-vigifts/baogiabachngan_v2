-- Read-only gate. Never creates tables, edits migration history or grants privileges.
DO $$ DECLARE t text; r text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['sales_production_folders','sales_production_files','sales_production_file_links'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'production files: missing table %; apply reviewed migration first',t; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN RAISE EXCEPTION 'production files: RLS missing on %',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,to_regclass('public.'||t),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'production files: browser role % has direct grants on %',r,t; END IF;
  END LOOP;
 END LOOP;
 FOR c IN SELECT * FROM (VALUES ('sales_production_folders','quote_id'),('sales_production_folders','drive_id'),('sales_production_files','quote_revision'),('sales_production_files','md5'),('sales_production_files','sha256'),('sales_production_files','status'),('sales_production_file_links','file_id'),('sales_production_file_links','order_id')) AS v(tab,col) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=c.tab AND column_name=c.col) THEN RAISE EXCEPTION 'production files: missing column %.%',c.tab,c.col; END IF;
 END LOOP;
END $$;
