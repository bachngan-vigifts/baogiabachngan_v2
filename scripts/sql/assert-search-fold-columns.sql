-- Read-only gate: chạy 20261119090000_search_fold_columns.sql trước khi triển khai API (tìm kiếm dùng cột search_fold).
DO $$
DECLARE name text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='search_fold' AND is_generated='ALWAYS') THEN
  RAISE EXCEPTION 'Run 20261119090000_search_fold_columns.sql manually (missing products.search_fold)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sapo_customers' AND column_name='search_fold' AND is_generated='ALWAYS') THEN
  RAISE EXCEPTION 'Run 20261119090000_search_fold_columns.sql manually (missing sapo_customers.search_fold)';
 END IF;
 FOREACH name IN ARRAY ARRAY['idx_web_notifications_member_created','idx_products_search_fold_col_trgm','idx_products_search_compact_col_trgm','idx_sapo_customers_search_fold_trgm','idx_sapo_customers_search_compact_trgm'] LOOP
  IF to_regclass('public.' || name) IS NULL THEN
   RAISE EXCEPTION 'Run 20261119090000_search_fold_columns.sql manually (missing %)', name;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.' || name) AND i.indisvalid) THEN
   RAISE EXCEPTION '% exists but is not valid; drop and re-run 20261119090000_search_fold_columns.sql', name;
  END IF;
 END LOOP;
END $$;
