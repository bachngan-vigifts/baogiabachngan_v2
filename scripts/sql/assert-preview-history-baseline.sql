-- Read-only verification after the manual history repair. No application rows are read.
BEGIN TRANSACTION READ ONLY;
DO $assert$
BEGIN
 IF EXISTS (
  SELECT 1 FROM (VALUES ('20261019035500','web_store_orders'),('20261019043000','web_store_order_ghn'),
   ('20261022204500','web_order_ghn_address'),('20261026042035','inventory_adjustment_approval')) expected(version,name)
  WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations h
    WHERE h.version=expected.version AND h.name=expected.name AND cardinality(h.statements)>0)
 ) THEN RAISE EXCEPTION 'Preview baseline history is incomplete. Do not reset or merge the Preview yet.'; END IF;
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
   WHERE version='20261019035500' AND array_to_string(statements,E'\n') LIKE '%CREATE TABLE "web_store_orders"%')
 THEN RAISE EXCEPTION 'Web-order table creation is missing from replay history.'; END IF;
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
   WHERE version='20261026042035' AND array_to_string(statements,E'\n') LIKE '%CREATE TABLE IF NOT EXISTS public.inventory_adjustments%')
 THEN RAISE EXCEPTION 'Stocktake/adjustment table creation is missing from replay history.'; END IF;
 IF to_regclass('public.web_store_orders') IS NULL OR to_regclass('public.inventory_adjustments') IS NULL
 THEN RAISE EXCEPTION 'Existing schema is incomplete.'; END IF;
END $assert$;
SELECT 'preview_history_baseline_ok' AS result;
COMMIT;
