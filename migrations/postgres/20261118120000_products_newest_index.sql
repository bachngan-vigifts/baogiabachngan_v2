-- Danh mục sản phẩm (trang 500 dòng của /catalog-snapshot, POS, nhập hàng) sắp xếp "mới tạo lên trước" theo newestProducts()
-- (src/modules/catalog/api/product-query.ts). Không có chỉ mục khớp, mỗi trang phải sắp xếp lại toàn bộ ~12.000 sản phẩm và tràn ra đĩa
-- (file tạm), làm cạn hạn mức Disk IO của Supabase. Chỉ mục này khớp đúng biểu thức sắp xếp (chuỗi bỏ dấu phải giống hệt foldSql()
-- ở src/core/text/fold.ts) nên trang được đọc thẳng theo thứ tự, không còn bước sắp xếp.
-- Chỉ thêm chỉ mục, không đổi dữ liệu; chạy lại được. Bảng ~12.000 dòng nên tạo chỉ mục chỉ mất khoảng 1 giây.
CREATE INDEX IF NOT EXISTS "idx_products_newest_active" ON "products" (
 "created_at" DESC NULLS LAST,
 (case when "sapo_product_id" ~ '^[0-9]{1,18}$' then "sapo_product_id"::bigint end) DESC NULLS LAST,
 translate(lower(coalesce("name", '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ̛̣̀́̂̃̆̉', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
 "sku"
) WHERE "active";
