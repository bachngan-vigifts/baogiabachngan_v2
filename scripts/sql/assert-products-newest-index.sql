-- Read-only gate: chạy 20261118120000_products_newest_index.sql trước khi kiểm tra tốc độ danh mục.
DO $$ BEGIN
 IF to_regclass('public.idx_products_newest_active') IS NULL THEN
  RAISE EXCEPTION 'Run 20261118120000_products_newest_index.sql manually (missing idx_products_newest_active)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid='public.idx_products_newest_active'::regclass AND i.indisvalid) THEN
  RAISE EXCEPTION 'idx_products_newest_active exists but is not valid; drop and re-run the migration';
 END IF;
END $$;
