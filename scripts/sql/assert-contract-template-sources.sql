DO $$ BEGIN
 IF to_regclass('public.sales_contract_template_sources') IS NULL THEN
  RAISE EXCEPTION 'Run contract_template_sources migration';
 END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_contract_template_sources' AND column_name IN ('brand','document_type','revision','file_key','file_name','source_hash','client_key','created_by','created_at') AND is_nullable='NO' AND ((column_name='revision' AND data_type='integer') OR (column_name<>'revision' AND data_type='text')))<>9 THEN
  RAISE EXCEPTION 'Incomplete contract template source columns';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='sales_contract_template_sources'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Contract template sources RLS missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sales_contract_template_sources'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (brand, document_type, revision)') OR
 NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sales_contract_template_sources'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (created_by, client_key)') THEN
  RAISE EXCEPTION 'Contract template sources revision/idempotency key missing';
 END IF;
END $$;
