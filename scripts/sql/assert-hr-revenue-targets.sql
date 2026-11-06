DO $$ BEGIN
 IF to_regclass('public.hr_revenue_targets') IS NULL THEN
  RAISE EXCEPTION 'Apply reviewed hr_revenue_targets migration before deploying API';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.hr_revenue_targets'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'hr_revenue_targets must enable RLS';
 END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_revenue_targets' AND column_name IN ('member_id','month','amount','updated_by','updated_at'))<>5 THEN
  RAISE EXCEPTION 'hr_revenue_targets schema is incomplete';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (has_table_privilege(rolname,'public.hr_revenue_targets','SELECT') OR has_table_privilege(rolname,'public.hr_revenue_targets','INSERT') OR has_table_privilege(rolname,'public.hr_revenue_targets','UPDATE') OR has_table_privilege(rolname,'public.hr_revenue_targets','DELETE'))) THEN
  RAISE EXCEPTION 'hr_revenue_targets must not grant direct anon/authenticated access';
 END IF;
END $$;
