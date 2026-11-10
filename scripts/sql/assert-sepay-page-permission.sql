-- Read-only rollout gate. Do not require Accounting to retain the permission:
-- Manager may legitimately revoke it after the initial seed.
DO $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs
  WHERE id='migration:sepay-page-permission' AND module='staff'
   AND action='migration.sepay-page-permission' AND entity_type='permission' AND entity_id='page.sepay') THEN
  RAISE EXCEPTION 'Chưa chạy 20261110020309_sepay_page_permission.sql. Chạy migration rồi assert-sepay-page-permission.sql.';
 END IF;
END
$assert$;
SELECT 'sepay_page_permission_ready' AS result;
