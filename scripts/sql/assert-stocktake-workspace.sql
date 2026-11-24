-- Read-only deployment gate for 20261124043000_stocktake_workspace.sql.
DO $$ DECLARE t text; r text; n text; BEGIN
 FOREACH t IN ARRAY ARRAY['inventory_stocktake_states','inventory_stocktake_commands'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Run 20261124043000_stocktake_workspace.sql: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'Stocktake table % must remain private with RLS',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass('public.'||t) AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC must not access stocktake metadata'; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Role % must not access stocktake metadata',r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') AND has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Do not delete stocktake command history'; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['adjustment_id','revision','costs','balanced_at','balanced_by','cancelled_at','cancelled_by','merged_into'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_stocktake_states' AND column_name=n) THEN RAISE EXCEPTION 'Missing stocktake state column %',n; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['idx_stocktake_states_balanced_by','idx_stocktake_states_cancelled_by','idx_stocktake_states_merged_into','uq_stocktake_command_actor_key','idx_stocktake_commands_document'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||n) AND indisvalid) THEN RAISE EXCEPTION 'Missing valid stocktake index %',n; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['stocktake_revision_nonnegative','stocktake_cancelled_actor_pair','stocktake_balanced_actor_pair','stocktake_command_key_hash'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=n AND convalidated) THEN RAISE EXCEPTION 'Missing validated stocktake check %',n; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.uq_stocktake_command_actor_key'::regclass AND indisunique) THEN RAISE EXCEPTION 'Missing unique stocktake command key'; END IF;
END $$;
