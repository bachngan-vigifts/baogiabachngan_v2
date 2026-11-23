DO $check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron' AND split_part(extversion,'.',1)::int>=1 AND (split_part(extversion,'.',1)::int>1 OR split_part(extversion,'.',2)::int>=6)) THEN RAISE EXCEPTION 'pg_cron >= 1.6 required for seconds scheduling; do not silently install a slower worker'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='sapo_sync_token') THEN RAISE EXCEPTION 'Existing sync credential required in Vault'; END IF;
END $check$;
-- Reviewed manual rollout AFTER applying edge_sync_jobs migration. Never paste tokens here.
-- Uses the same existing Vault secret as scheduled Sapo/GHN (no new client credentials).
CREATE OR REPLACE FUNCTION public.edge_sync_jobs_tick() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.edge_sync_jobs j WHERE j.key<>'__dispatcher'
   AND j.available_at<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   AND (j.status='queued' OR j.status='running' AND j.lease_until<=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 OR EXISTS(SELECT 1 FROM public.edge_sync_jobs j WHERE j.key='__dispatcher'
   AND j.lease_until>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RETURN NULL; END IF;
 RETURN net.http_post(
  url:='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/sync-jobs/tick',
  headers:=jsonb_build_object('content-type','application/json','authorization',
   'Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sapo_sync_token')),
  body:='{}'::jsonb, timeout_milliseconds:=60000);
END $fn$;
REVOKE ALL ON FUNCTION public.edge_sync_jobs_tick() FROM PUBLIC,anon,authenticated;
-- pg_cron >=1.6 supports seconds. DB readiness checks suppress HTTP entirely when queue is idle/busy.
-- Original 5/30-minute schedules only enqueue; the global persisted lease permits ONE active step.
SELECT cron.schedule('edge-sync-jobs','1 second',$job$SELECT public.edge_sync_jobs_tick();$job$);
