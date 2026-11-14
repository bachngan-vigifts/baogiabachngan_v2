DO $$ BEGIN
 IF to_regclass('public.sales_contract_template_versions') IS NULL THEN
  RAISE EXCEPTION 'Apply 20261114110000_contract_templates.sql before deploying contract templates';
 END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_contract_template_versions' AND is_nullable='NO' AND ((column_name IN ('brand','source_hash','edits','created_by','created_at') AND data_type='text') OR (column_name='revision' AND data_type='integer')))<>6 THEN RAISE EXCEPTION 'Contract template columns missing or invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.sales_contract_template_versions'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Contract template RLS is required'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.sales_contract_template_versions'::regclass AND convalidated AND conname IN ('chk_contract_template_brand','chk_contract_template_revision','chk_contract_template_payload'))<>3 THEN RAISE EXCEPTION 'Contract template constraints missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sales_contract_template_versions'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (brand, revision)') THEN RAISE EXCEPTION 'Contract template revision key missing'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='sales_contract_template_versions' AND grantee IN ('PUBLIC','anon','authenticated')) THEN RAISE EXCEPTION 'Contract templates must only be accessed through the server'; END IF;
END $$;
