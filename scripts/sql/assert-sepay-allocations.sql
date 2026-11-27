-- Read-only gate for 20261123095718_sepay_allocations.sql.
DO $$ DECLARE t text; n text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['sepay_reconciliation_states','sepay_allocation_batches','sepay_payment_allocations'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Run 20261123095718_sepay_allocations.sql: missing %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'SePay allocation table % must remain private with RLS',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||t) AND contype='p') THEN RAISE EXCEPTION 'Missing allocation primary key %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass('public.'||t) AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC must not access allocation table %',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Role % must not access allocations',r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') AND has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE') THEN RAISE EXCEPTION 'service_role must not delete allocation history'; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['uq_sepay_allocation_client','idx_sepay_batches_transaction','uq_sepay_allocation_target','uq_sepay_allocation_receipt','idx_sepay_alloc_order','idx_sepay_alloc_web','idx_sepay_alloc_void_actor'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||n) AND indisvalid AND (n NOT LIKE 'uq_%' OR indisunique)) THEN RAISE EXCEPTION 'Missing valid allocation index %',n; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['chk_sepay_allocation_revision','chk_sepay_batch_key','chk_sepay_allocation_amount','chk_sepay_allocation_destination','chk_sepay_allocation_void'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=n AND convalidated) THEN RAISE EXCEPTION 'Missing validated allocation constraint %',n; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.sepay_reconciliation_states'::regclass,'public.sepay_allocation_batches'::regclass,'public.sepay_payment_allocations'::regclass) AND contype='f')<8 THEN RAISE EXCEPTION 'Missing allocation foreign keys'; END IF;
END $$;
