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

-- Additive dispatch metadata must exist before the API loads the new schema.
DO $$ DECLARE c text; BEGIN
 FOREACH c IN ARRAY ARRAY['queued_at','offered_at','creation_hash'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouse_work_runs' AND column_name=c) THEN RAISE EXCEPTION 'Apply 20261110041042_warehouse_dispatch_availability.sql: missing warehouse_work_runs.%',c; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouse_work_settings' AND column_name='auto_dispatch') THEN RAISE EXCEPTION 'Apply 20261110041042_warehouse_dispatch_availability.sql: missing auto_dispatch'; END IF;
END $$;

-- Source/team assignment is additive, but must be present before the new API is loaded.
DO $$ DECLARE t text; r regclass; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_work_assignments','warehouse_work_source_links','warehouse_work_parts'] LOOP
  r:=to_regclass('public.'||t);
  IF r IS NULL THEN RAISE EXCEPTION 'Apply 20261111061143_warehouse_source_assignment.sql: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=r AND relrowsecurity) THEN RAISE EXCEPTION 'RLS required on %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'anon cannot access %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',r,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'authenticated cannot access %',t; END IF;
 END LOOP;
END $$;
