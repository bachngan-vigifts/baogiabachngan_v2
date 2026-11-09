-- Read-only deployment gate for 20261108223847_warehouse_workspace.sql.
DO $$ DECLARE t text; relation regclass; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_work_settings','warehouse_work_runs','warehouse_work_months'] LOOP
  relation:=to_regclass('public.'||t);
  IF relation IS NULL THEN RAISE EXCEPTION 'Apply 20261108223847_warehouse_workspace.sql before API deploy: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relrowsecurity) THEN RAISE EXCEPTION 'RLS required on %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'anon cannot access %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'authenticated cannot access %',t; END IF;
 END LOOP;
END $$;
