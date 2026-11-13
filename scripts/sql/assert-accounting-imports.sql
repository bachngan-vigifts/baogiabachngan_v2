-- Read-only. Apply 20261113062905_accounting_resumable_imports.sql before API deployment.
DO $$ DECLARE t text; r regclass; required record; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_import_jobs','accounting_import_chunks','accounting_import_rows'] LOOP
  r:=to_regclass('public.'||t);
  IF r IS NULL THEN RAISE EXCEPTION 'Apply 20261113062905_accounting_resumable_imports.sql: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=r AND relrowsecurity) THEN RAISE EXCEPTION 'Incomplete 20261113062905_accounting_resumable_imports.sql: RLS %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid=r AND indisprimary AND indisvalid AND indisready) THEN RAISE EXCEPTION 'Incomplete 20261113062905_accounting_resumable_imports.sql: primary key %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Private imports must deny anon on %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Private imports must deny authenticated on %',t; END IF;
 END LOOP;
 FOR required IN SELECT * FROM (VALUES
  ('accounting_import_jobs','id'),('accounting_import_jobs','owner_id'),('accounting_import_jobs','file_hash'),('accounting_import_jobs','total_rows'),('accounting_import_jobs','book_id'),('accounting_import_jobs','entity_id'),('accounting_import_jobs','filename'),('accounting_import_jobs','date'),('accounting_import_jobs','kind'),('accounting_import_jobs','reference'),('accounting_import_jobs','note'),('accounting_import_jobs','policy_id'),('accounting_import_jobs','policy_name'),('accounting_import_jobs','state'),('accounting_import_jobs','document_id'),('accounting_import_jobs','created_at'),('accounting_import_jobs','updated_at'),
  ('accounting_import_chunks','job_id'),('accounting_import_chunks','chunk_no'),('accounting_import_chunks','hash'),('accounting_import_chunks','row_count'),('accounting_import_chunks','error_count'),('accounting_import_chunks','created_at'),
  ('accounting_import_rows','job_id'),('accounting_import_rows','line_no'),('accounting_import_rows','source_row'),('accounting_import_rows','sku'),('accounting_import_rows','raw_quantity'),('accounting_import_rows','quantity'),('accounting_import_rows','name'),('accounting_import_rows','unit'),('accounting_import_rows','unit_price'),('accounting_import_rows','net_value'),('accounting_import_rows','error'),('accounting_import_rows','priced_at')
 ) AS cols(tbl,col) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=required.tbl AND column_name=required.col) THEN RAISE EXCEPTION 'Incomplete 20261113062905_accounting_resumable_imports.sql: %.%',required.tbl,required.col; END IF;
 END LOOP;
END $$;
