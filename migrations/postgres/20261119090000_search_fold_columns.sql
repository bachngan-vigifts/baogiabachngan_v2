-- Tốc độ (đo production 19/11/2026, máy CSDL Micro, CPU dùng chung):
-- * Tìm sản phẩm / khách hàng phải chạy translate(lower(...)) bỏ dấu trên mọi dòng mỗi lần tìm: 1,2 s (12k sản phẩm), 0,34–0,58 s (10k khách).
--   Chỉ mục trigram theo biểu thức (20261103095218) có nhưng planner không chọn vì bảng nhỏ. Lưu sẵn chuỗi đã bỏ dấu vào cột sinh tự động
--   `search_fold` (STORED, PostgreSQL tự cập nhật khi sửa dòng) để mỗi lần tìm chỉ còn so LIKE, kèm chỉ mục trigram trên cột này.
--   Biểu thức giống hệt foldSql() ở src/core/text/fold.ts (test kiểm tra chuỗi FROM/TO).
-- * Kiểm tra chuông thông báo: điều kiện "gửi riêng cho tôi" (target_member_id) không dùng được chỉ mục hiện có.
-- Không đổi dữ liệu nghiệp vụ. Thêm cột sinh tự động sẽ ghi lại bảng products (~12k dòng) và sapo_customers (~10k dòng): chạy ngoài giờ bán.
-- Chạy lại được. Hoàn tác: DROP INDEX các chỉ mục mới; ALTER TABLE ... DROP COLUMN search_fold.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_fold text GENERATED ALWAYS AS (translate(lower(coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' || coalesce("brand", '') || ' ' || coalesce("pattern", '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ̛̣̀́̂̃̆̉', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;
ALTER TABLE public.sapo_customers ADD COLUMN IF NOT EXISTS search_fold text GENERATED ALWAYS AS (translate(lower(coalesce("name", '') || ' ' || coalesce("contact", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("email", '') || ' ' || coalesce("tax_code", '') || ' ' || coalesce("customer_code", '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ̛̣̀́̂̃̆̉', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;
CREATE INDEX IF NOT EXISTS idx_web_notifications_member_created ON public.staff_web_notifications (target_member_id, created_at) WHERE target_member_id IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_products_search_fold_col_trgm ON public.products USING gin (search_fold gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_products_search_compact_col_trgm ON public.products USING gin ((regexp_replace(search_fold, '[^a-z0-9]', '', 'g')) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_sapo_customers_search_fold_trgm ON public.sapo_customers USING gin (search_fold gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_sapo_customers_search_compact_trgm ON public.sapo_customers USING gin ((regexp_replace(search_fold, '[^a-z0-9]', '', 'g')) gin_trgm_ops);
  END IF;
END $$;
