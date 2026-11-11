-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('table sales_payroll_team_sources', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.sales_payroll_team_sources') AND relkind='r'))),
  ('effective_month', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='effective_month' AND data_type='text' AND is_nullable='NO'))),
  ('bn_register_id', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='bn_register_id' AND data_type='text' AND is_nullable='NO'))),
  ('lock_register_id', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='lock_register_id' AND data_type='text' AND is_nullable='NO'))),
  ('bonus_mode', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='bonus_mode' AND data_type='text' AND is_nullable='NO'))),
  ('updated_by', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='updated_by' AND data_type='text' AND is_nullable='NO'))),
  ('updated_at', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_payroll_team_sources' AND column_name='updated_at' AND data_type='text' AND is_nullable='NO'))),
  ('PK month', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND contype='p' AND convalidated AND pg_get_constraintdef(oid)='PRIMARY KEY (effective_month)'))),
  ('CHECK month', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='chk_sales_payroll_sources_month' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'^[0-9]{4}-(0[1-9]|1[0-2])$')>0))),
  ('CHECK distinct', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='chk_sales_payroll_sources_distinct' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'bn_register_id <> lock_register_id')>0))),
  ('CHECK mode', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='chk_sales_payroll_sources_mode' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'''threshold''')>0 AND strpos(pg_get_constraintdef(oid),'''tiers''')>0))),
  ('bn index', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_sales_payroll_sources_bn' AND i.indrelid=to_regclass('public.sales_payroll_team_sources') AND i.indisvalid AND i.indisready AND a.amname='btree' AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='bn_register_id' AND i.indpred IS NULL))),
  ('FK bn_register_id', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='sales_payroll_team_sources_bn_register_id_fkey' AND contype='f' AND convalidated AND strpos(pg_get_constraintdef(oid),'FOREIGN KEY (bn_register_id) REFERENCES pos_registers(id)')>0))),
  ('lock index', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_sales_payroll_sources_lock' AND i.indrelid=to_regclass('public.sales_payroll_team_sources') AND i.indisvalid AND i.indisready AND a.amname='btree' AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='lock_register_id' AND i.indpred IS NULL))),
  ('FK lock_register_id', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='sales_payroll_team_sources_lock_register_id_fkey' AND contype='f' AND convalidated AND strpos(pg_get_constraintdef(oid),'FOREIGN KEY (lock_register_id) REFERENCES pos_registers(id)')>0))),
  ('editor index', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_sales_payroll_sources_editor' AND i.indrelid=to_regclass('public.sales_payroll_team_sources') AND i.indisvalid AND i.indisready AND a.amname='btree' AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='updated_by' AND i.indpred IS NULL))),
  ('FK updated_by', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_payroll_team_sources') AND conname='sales_payroll_team_sources_updated_by_fkey' AND contype='f' AND convalidated AND strpos(pg_get_constraintdef(oid),'FOREIGN KEY (updated_by) REFERENCES staff_members(id)')>0))),
  ('sales_payroll_team_sources RLS', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.sales_payroll_team_sources') AND relrowsecurity))),
  ('sales_payroll_team_sources không cấp trực tiếp PUBLIC/anon/authenticated', (NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p LEFT JOIN pg_roles r ON r.oid=p.grantee WHERE c.oid=to_regclass('public.sales_payroll_team_sources') AND (p.grantee=0 OR r.rolname IN ('anon','authenticated'))) AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') AND has_table_privilege(r.oid,to_regclass('public.sales_payroll_team_sources'),'SELECT,INSERT,UPDATE,DELETE'))))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261106035214_sales_payroll_team_sources.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'sales_payroll_team_sources_complete_ready' AS result;
