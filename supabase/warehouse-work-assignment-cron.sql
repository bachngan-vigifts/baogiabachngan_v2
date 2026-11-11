-- Install after migration + API deploy. Reuses the existing server token in Vault; never expose it in UI.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='sapo_sync_token' AND length(decrypted_secret)>=32) THEN
  RAISE EXCEPTION 'Missing server token in Vault; warehouse reconciliation was not scheduled.';
 END IF;
END $$;
SELECT cron.schedule('warehouse-work-assignment-reconcile','*/5 * * * *',$job$
 SELECT net.http_post(
  url:='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/warehouse-work/reconcile',
  headers:=jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sapo_sync_token')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
SELECT jobname,schedule,active FROM cron.job WHERE jobname='warehouse-work-assignment-reconcile';
