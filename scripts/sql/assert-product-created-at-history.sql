-- Read-only replay prerequisite: created_at must precede the newest-products index.
DO $assert$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261023120000' AND name='product_created_at' AND cardinality(statements)>0)
 THEN RAISE EXCEPTION 'Repair product_created_at replay history before rebuilding Preview'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='created_at' AND data_type='text')
 THEN RAISE EXCEPTION 'Missing products.created_at'; END IF;
END $assert$;
