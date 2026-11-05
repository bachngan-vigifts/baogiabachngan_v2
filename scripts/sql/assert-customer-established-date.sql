-- Read-only gate: apply the customer_established_date migration before deploying this API.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='sapo_customers' AND column_name='established_date' AND data_type='date') THEN
  RAISE EXCEPTION 'Missing customer established_date. Apply customer_established_date migration before deployment.';
 END IF;
END $$;
