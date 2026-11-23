-- Read-only gate: run 20261122090000_transfer_create_mode.sql before API deployment.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_transfers' AND column_name='create_mode' AND data_type='text' AND is_nullable='YES') THEN
  RAISE EXCEPTION 'Run 20261122090000_transfer_create_mode.sql: missing nullable stock_transfers.create_mode';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_transfers'::regclass AND conname='chk_stock_transfer_create_mode' AND convalidated AND pg_get_constraintdef(oid) = $definition$CHECK ((create_mode = ANY (ARRAY['request'::text, 'approve'::text, 'ship'::text])))$definition$) THEN
  RAISE EXCEPTION 'Missing validated chk_stock_transfer_create_mode';
 END IF;
END $$;
