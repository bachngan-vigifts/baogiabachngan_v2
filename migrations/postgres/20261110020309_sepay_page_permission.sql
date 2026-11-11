-- Preserve the existing Accounting access once. The marker prevents later deploys
-- or manual replays from restoring a permission that Manager explicitly revoked.
-- No financial data, sessions, RLS policies or other position permissions change.
DO $seed$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.staff_positions WHERE id='accounting') THEN
  RAISE EXCEPTION 'Missing Accounting position; SePay permission seed stopped';
 END IF;
 WITH first_run AS (
  INSERT INTO public.audit_logs(id,actor_id,module,action,entity_type,entity_id,data,created_at)
  VALUES('migration:sepay-page-permission',NULL,'staff','migration.sepay-page-permission','permission','page.sepay',
   '{"permission":"page.sepay","defaultPosition":"accounting","confirmation":"manager_only"}',
   to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ON CONFLICT(id) DO NOTHING RETURNING id
 )
 INSERT INTO public.staff_position_permissions(position_id,permission)
 SELECT 'accounting','page.sepay' FROM first_run
 ON CONFLICT(position_id,permission) DO NOTHING;
END
$seed$;
