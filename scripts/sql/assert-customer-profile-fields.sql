-- Read-only gate: apply the customer_profile_fields migration before deploying this API.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sapo_customers'
     AND column_name IN ('payment_days','representative_contact_id','reject_reason','rejected_by','rejected_at')) <> 5 THEN
  RAISE EXCEPTION 'Missing sapo_customers profile columns. Apply customer_profile_fields migration before deployment.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_sapo_customers_approval'
     AND conrelid='public.sapo_customers'::regclass AND pg_get_constraintdef(oid) LIKE '%rejected%') THEN
  RAISE EXCEPTION 'approval_status does not accept rejected. Apply customer_profile_fields migration before deployment.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_customer_reject_reason' AND conrelid='public.sapo_customers'::regclass) THEN
  RAISE EXCEPTION 'Missing chk_customer_reject_reason. Apply customer_profile_fields migration before deployment.';
 END IF;
 IF to_regclass('public.customer_debt_notes') IS NULL THEN
  RAISE EXCEPTION 'Missing customer_debt_notes. Apply customer_profile_fields migration before deployment.';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_debt_notes'::regclass) THEN
  RAISE EXCEPTION 'customer_debt_notes must have row level security enabled.';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (has_table_privilege(rolname, 'public.customer_debt_notes', 'SELECT')
     OR has_table_privilege(rolname, 'public.customer_debt_notes', 'INSERT') OR has_table_privilege(rolname, 'public.customer_debt_notes', 'UPDATE')
     OR has_table_privilege(rolname, 'public.customer_debt_notes', 'DELETE'))) THEN
  RAISE EXCEPTION 'customer_debt_notes must not grant direct access to anon/authenticated.';
 END IF;
END $$;
