-- Read-only: the Preview bootstrap replays this registry, not Drizzle filenames.
DO $verify$
DECLARE created_version text;
BEGIN
 SELECT min(version) INTO created_version FROM supabase_migrations.schema_migrations
 WHERE array_to_string(statements,E'\n') ~* 'CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(public\.)?"?web_store_orders"?\s*\(';
 IF created_version IS NULL THEN
  RAISE EXCEPTION 'Missing CREATE web_store_orders in replay history. Restore verified missing history before rebuilding Preview.';
 END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version < created_version AND array_to_string(statements,E'\n') ~* '\mweb_store_orders\M') THEN
  RAISE EXCEPTION 'A web_store_orders dependency precedes its CREATE in replay history.';
 END IF;
 IF to_regclass('public.web_store_orders') IS NULL OR NOT EXISTS(
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='web_store_orders'
  AND column_name='financial_snapshot' AND data_type='text' AND is_nullable='NO') THEN
  RAISE EXCEPTION 'web_store_orders.financial_snapshot is missing or incompatible.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.web_store_orders'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'web_store_orders must keep RLS enabled.';
 END IF;
END $verify$;
SELECT 'web_order_replay_history_ok' AS result;
