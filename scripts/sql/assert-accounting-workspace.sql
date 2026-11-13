-- Read-only gate: never silently deploy an API against missing private accounting tables.
DO $$ DECLARE t text; r regclass; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_entities','accounting_books','accounting_documents','accounting_lines','accounting_periods','accounting_reviews'] LOOP
  r:=to_regclass('public.'||t);
  IF r IS NULL THEN RAISE EXCEPTION 'Apply 20261113002619_accounting_workspace.sql: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=r AND relrowsecurity) THEN RAISE EXCEPTION 'RLS required on %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'anon cannot access %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'authenticated cannot access %',t; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting_books' AND column_name='invoice_provider') THEN RAISE EXCEPTION 'Missing accounting_books.invoice_provider'; END IF;
END $$;
DO $$ DECLARE required record; BEGIN
 FOR required IN SELECT * FROM (VALUES
  ('accounting_entities','reference_k'),('accounting_entities','tax_code'),('accounting_entities','revision'),
  ('accounting_books','entity_id'),('accounting_books','opening_date'),('accounting_books','revision'),
  ('accounting_documents','source_order_id'),('accounting_documents','source_revision'),('accounting_documents','revision'),('accounting_documents','state'),
  ('accounting_lines','carrying_value'),('accounting_lines','tax_rate'),('accounting_lines','net_value'),
  ('accounting_periods','verified_at'),('accounting_reviews','fingerprint')
 ) AS required_columns(tbl,col) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=required.tbl AND column_name=required.col) THEN RAISE EXCEPTION 'Incomplete 20261113002619_accounting_workspace.sql: %.%',required.tbl,required.col; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_accounting_source_order' AND indexdef LIKE 'CREATE UNIQUE INDEX%') THEN RAISE EXCEPTION 'Missing source-order uniqueness in 20261113002619_accounting_workspace.sql'; END IF;
END $$;
