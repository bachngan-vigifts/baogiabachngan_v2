DO $$ BEGIN
 IF to_regclass('public.sales_payroll_team_sources') IS NULL THEN RAISE EXCEPTION 'Missing sales_payroll_team_sources migration'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sales_payroll_team_sources'::regclass) THEN RAISE EXCEPTION 'Team source RLS disabled'; END IF;
 IF has_table_privilege('anon','public.sales_payroll_team_sources','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.sales_payroll_team_sources','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Team sources exposed'; END IF;
END $$;
