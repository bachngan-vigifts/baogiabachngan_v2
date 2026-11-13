DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='archived_at') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='archived_by') THEN
 RAISE EXCEPTION 'Apply 20261113104533_product_archive_controls.sql before deploying product archive'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.products'::regclass AND conname='chk_products_archived_inactive' AND convalidated) THEN RAISE EXCEPTION 'Missing validated product archive constraint'; END IF;
END $$;
