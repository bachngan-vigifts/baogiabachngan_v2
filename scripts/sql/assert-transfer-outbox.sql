DO $$ BEGIN
 IF to_regclass('public.stock_transfer_outbox') IS NULL OR to_regclass('public.stock_transfer_integration_settings') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_transfer_lines' AND column_name='shipped_qty') THEN
   RAISE EXCEPTION 'Run migration 20261102104511_transfer_received_outbox.sql manually before deploying this API';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.stock_transfer_outbox'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.stock_transfer_integration_settings'::regclass AND relrowsecurity) THEN
   RAISE EXCEPTION 'Transfer integration tables require RLS';
 END IF;
END $$;
