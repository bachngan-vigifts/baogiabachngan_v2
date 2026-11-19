-- Manual metadata repair for a migration already applied by the deploy workflow.
-- The dollar-quoted source is stored for future schema replay; it is NOT executed here.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='created_at' AND data_type='text')
 OR to_regclass('public.idx_products_created_at') IS NULL THEN
  RAISE EXCEPTION 'Existing product-created-at schema must be present before repairing its history';
 END IF;
END $guard$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('20261023120000','product_created_at',ARRAY[$product_created_at_source$-- Ngày tạo sản phẩm: trang Sản phẩm và Bán hàng nhanh xếp mới tạo lên đầu. Chạy lại nhiều lần vẫn an toàn (bước triển khai tự chạy trước khi đẩy code).
-- Sản phẩm thêm sau migration (web hoặc Sapo đồng bộ về) tự nhận giờ tạo. Sản phẩm cũ để trống – xếp theo mã sản phẩm Sapo (mã lớn hơn = tạo sau);
-- sản phẩm tạo trên web lấy giờ duyệt làm mốc gần đúng.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'products' and column_name = 'created_at') then
    alter table "products" add column "created_at" text;
    update "products" set "created_at" = "approved_at" where "created_by" is not null;
    alter table "products" alter column "created_at" set default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  end if;
end $$;
--> statement-breakpoint
create index if not exists "idx_products_created_at" on "products" ("created_at");
$product_created_at_source$]::text[])
ON CONFLICT(version) DO NOTHING;
DO $verify$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261023120000' AND name='product_created_at' AND statements=ARRAY[$product_created_at_source$-- Ngày tạo sản phẩm: trang Sản phẩm và Bán hàng nhanh xếp mới tạo lên đầu. Chạy lại nhiều lần vẫn an toàn (bước triển khai tự chạy trước khi đẩy code).
-- Sản phẩm thêm sau migration (web hoặc Sapo đồng bộ về) tự nhận giờ tạo. Sản phẩm cũ để trống – xếp theo mã sản phẩm Sapo (mã lớn hơn = tạo sau);
-- sản phẩm tạo trên web lấy giờ duyệt làm mốc gần đúng.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'products' and column_name = 'created_at') then
    alter table "products" add column "created_at" text;
    update "products" set "created_at" = "approved_at" where "created_by" is not null;
    alter table "products" alter column "created_at" set default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  end if;
end $$;
--> statement-breakpoint
create index if not exists "idx_products_created_at" on "products" ("created_at");
$product_created_at_source$]::text[]) THEN
  RAISE EXCEPTION 'History exists with different content; no overwrite performed';
 END IF;
END $verify$;
COMMIT;
