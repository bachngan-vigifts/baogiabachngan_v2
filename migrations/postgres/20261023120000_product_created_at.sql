-- Ngày tạo sản phẩm: trang Sản phẩm và Bán hàng nhanh xếp mới tạo lên đầu. Chạy lại nhiều lần vẫn an toàn (bước triển khai tự chạy trước khi đẩy code).
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
