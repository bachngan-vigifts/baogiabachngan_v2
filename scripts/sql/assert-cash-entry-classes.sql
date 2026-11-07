-- Read-only gate: run 20261116090000_cash_entry_classes.sql manually before deploying the API (profit page reads Manager cash classes).
DO $$ BEGIN
 IF to_regclass('public.cash_entry_classes') IS NULL THEN RAISE EXCEPTION 'Run 20261116090000_cash_entry_classes.sql manually before deploying this API (missing cash_entry_classes)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.cash_entry_classes') AND relrowsecurity) THEN RAISE EXCEPTION 'cash_entry_classes requires RLS'; END IF;
END $$;
