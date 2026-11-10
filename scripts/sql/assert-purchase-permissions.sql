-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
-- Gate strict theo seed migration; nếu Manager đã thu quyền hợp lệ thì cần review chính sách gate, không chạy lại seed để tự cấp quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 IF to_regclass('public.staff_positions') IS NULL THEN RAISE EXCEPTION 'Thiếu bảng staff_positions. Đối chiếu và chạy 20261111090000_purchase_permissions.sql sau khi được duyệt.'; END IF;
 IF to_regclass('public.staff_position_permissions') IS NULL THEN RAISE EXCEPTION 'Thiếu bảng staff_position_permissions. Đối chiếu và chạy 20261111090000_purchase_permissions.sql sau khi được duyệt.'; END IF;
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('seed purchases.early-view theo page.purchases', (NOT EXISTS(SELECT 1 FROM public.staff_position_permissions p WHERE p.permission='page.purchases' AND NOT EXISTS(SELECT 1 FROM public.staff_position_permissions x WHERE x.position_id=p.position_id AND x.permission='purchases.early-view')))),
  ('5 quyền mặc định mua hàng', (NOT EXISTS(SELECT 1 FROM (VALUES ('sale-admin','purchases.early-request'),('sale-admin','purchases.confirm'),('accounting','purchases.confirm'),('sale-admin','purchases.cancel-approved'),('accounting','purchases.receive')) expected(position_id,permission) JOIN public.staff_positions s ON s.id=expected.position_id WHERE NOT EXISTS(SELECT 1 FROM public.staff_position_permissions p WHERE p.position_id=expected.position_id AND p.permission=expected.permission))))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261111090000_purchase_permissions.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'purchase_permissions_ready' AS result;
