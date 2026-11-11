-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('table hr_revenue_targets', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.hr_revenue_targets') AND relkind='r'))),
  ('member_id', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name='member_id' AND data_type='text' AND is_nullable='NO'))),
  ('month', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name='month' AND data_type='text' AND is_nullable='NO'))),
  ('amount', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name='amount' AND data_type='double precision' AND is_nullable='NO'))),
  ('updated_by', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name='updated_by' AND data_type='text' AND is_nullable='YES'))),
  ('updated_at', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name='updated_at' AND data_type='text' AND is_nullable='NO'))),
  ('PK member/month', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_revenue_targets') AND contype='p' AND convalidated AND pg_get_constraintdef(oid)='PRIMARY KEY (member_id, month)'))),
  ('month index', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_hr_revenue_targets_month' AND i.indrelid=to_regclass('public.hr_revenue_targets') AND i.indisvalid AND i.indisready AND a.amname='btree' AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='month' AND i.indpred IS NULL))),
  ('month CHECK', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_revenue_targets') AND conname='chk_hr_revenue_target_month' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'^[0-9]{4}-(0[1-9]|1[0-2])$')>0))),
  ('amount CHECK', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_revenue_targets') AND conname='chk_hr_revenue_target_amount' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'amount >')>0 AND strpos(pg_get_constraintdef(oid),'10000000000000')>0 AND strpos(pg_get_constraintdef(oid),'floor(amount)')>0))),
  ('FK member_id', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_revenue_targets') AND conname='hr_revenue_targets_member_id_fkey' AND contype='f' AND convalidated AND strpos(pg_get_constraintdef(oid),'FOREIGN KEY (member_id) REFERENCES staff_members(id)')>0))),
  ('FK updated_by', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_revenue_targets') AND conname='hr_revenue_targets_updated_by_fkey' AND contype='f' AND convalidated AND strpos(pg_get_constraintdef(oid),'FOREIGN KEY (updated_by) REFERENCES staff_members(id)')>0))),
  ('hr_revenue_targets RLS', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.hr_revenue_targets') AND relrowsecurity))),
  ('hr_revenue_targets không cấp trực tiếp PUBLIC/anon/authenticated', (NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p LEFT JOIN pg_roles r ON r.oid=p.grantee WHERE c.oid=to_regclass('public.hr_revenue_targets') AND (p.grantee=0 OR r.rolname IN ('anon','authenticated'))) AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') AND has_table_privilege(r.oid,to_regclass('public.hr_revenue_targets'),'SELECT,INSERT,UPDATE,DELETE'))))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261106011701_hr_revenue_targets.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'hr_revenue_targets_complete_ready' AS result;
