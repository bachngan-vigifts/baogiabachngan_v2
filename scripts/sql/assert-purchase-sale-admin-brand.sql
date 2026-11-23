DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='sale_admin_brand' AND data_type='text' AND is_nullable='YES') THEN
  RAISE EXCEPTION 'Run purchase_supplier_sale_admin_brand migration: missing nullable suppliers.sale_admin_brand';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='suppliers'::regclass AND conname='chk_suppliers_sale_admin_brand' AND contype='c' AND convalidated AND pg_get_constraintdef(oid) LIKE '%minhlong%' AND pg_get_constraintdef(oid) LIKE '%locknlock%') THEN
  RAISE EXCEPTION 'Missing suppliers.sale_admin_brand check constraint';
 END IF;
END $$;
