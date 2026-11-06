-- Read-only gate: run 20261112110000_store_restock_rules.sql manually before deploying the API.
DO $$ BEGIN
 IF to_regclass('public.store_restock_rules') IS NULL THEN RAISE EXCEPTION 'Run 20261112110000_store_restock_rules.sql manually before deploying this API'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.store_restock_rules') AND relrowsecurity) THEN RAISE EXCEPTION 'store_restock_rules requires RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='store_restock_rules_pkey') THEN RAISE EXCEPTION 'store_restock_rules requires (warehouse_id, sku) primary key'; END IF;
END $$;
