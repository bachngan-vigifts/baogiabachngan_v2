-- Runtime readiness, separate from portable schema gates. Read-only; requires installed cron/Vault integration.
DO $assert$
BEGIN
 IF to_regprocedure('public.edge_sync_jobs_tick()') IS NULL THEN
  RAISE EXCEPTION 'Install supabase/edge-sync-jobs-cron.sql before deploying durable sync';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='edge-sync-jobs' AND active) THEN
  RAISE EXCEPTION 'Enable reviewed edge-sync-jobs schedule before deploying durable sync';
 END IF;
END $assert$;
