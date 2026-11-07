-- Read-only deployment gate. Apply 20261107064327_customer_center_campaigns.sql first.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['customer_campaigns','customer_campaign_targets'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=tbl AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'Missing customer center table/RLS: %. Apply customer_center_campaigns migration.',tbl;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=tbl AND grantee IN ('anon','authenticated','PUBLIC')) THEN
   RAISE EXCEPTION 'Customer center table % must not be directly exposed.',tbl;
  END IF;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_customer_campaign_activity') THEN
  RAISE EXCEPTION 'Missing campaign care deduplication index.';
 END IF;
END $$;
