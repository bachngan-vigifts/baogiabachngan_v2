-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
-- Thiếu seed cũng có thể do Manager chủ động thu quyền; chỉ báo lỗi để đối chiếu, tuyệt đối không tự cấp lại.
DO $assert$
DECLARE missing text[];
BEGIN
 IF to_regclass('public.staff_positions') IS NULL THEN RAISE EXCEPTION 'Thiếu bảng staff_positions. Đối chiếu và chạy 20261107074837_order_products_page_permission.sql sau khi được duyệt.'; END IF;
 IF to_regclass('public.staff_position_permissions') IS NULL THEN RAISE EXCEPTION 'Thiếu bảng staff_position_permissions. Đối chiếu và chạy 20261107074837_order_products_page_permission.sql sau khi được duyệt.'; END IF;
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('seed page.order-products theo page.orders', (NOT EXISTS(SELECT 1 FROM public.staff_position_permissions p WHERE p.permission='page.orders' AND p.position_id NOT IN ('manager','supplier','customer') AND NOT EXISTS(SELECT 1 FROM public.staff_position_permissions x WHERE x.position_id=p.position_id AND x.permission='page.order-products'))))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261107074837_order_products_page_permission.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'order_products_page_permission_ready' AS result;
