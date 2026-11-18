DO $assert$
BEGIN
 IF to_regclass('public.edge_sync_jobs') IS NULL THEN
  RAISE EXCEPTION 'Apply 20261118050000_edge_sync_jobs.sql: missing edge_sync_jobs';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.edge_sync_jobs'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'RLS required on edge_sync_jobs';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='edge_sync_jobs') THEN
  RAISE EXCEPTION 'Internal sync queue must not have client policies';
 END IF;
 IF to_regprocedure('public.edge_sync_jobs_tick()') IS NULL OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='edge-sync-jobs' AND active) THEN
  RAISE EXCEPTION 'Install supabase/edge-sync-jobs-cron.sql before deploying durable sync';
 END IF;
END $assert$;
