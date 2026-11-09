-- Operational schedule only. Deploy /integrations/sepay/pull before installing.
-- Reuses pg_cron/pg_net and the existing server token in Vault; no schema/business-data changes.
begin;
do $check$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron')
     or not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Thiếu pg_cron hoặc pg_net; chưa cài lịch SePay.';
  end if;
  if (select count(*) from vault.decrypted_secrets where name='sapo_sync_token') <> 1
     or not exists(select 1 from vault.decrypted_secrets where name='sapo_sync_token' and length(decrypted_secret)>=32) then
    raise exception 'Thiếu hoặc trùng token máy chủ trong Vault; chưa cài lịch SePay.';
  end if;
end
$check$;
select cron.schedule('sepay-pull-today','*/5 * * * *',$job$
  select net.http_post(
    url := 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/sepay/pull',
    headers := jsonb_build_object('content-type','application/json','authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='sapo_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 100000);
$job$);
select jobname,schedule,active from cron.job where jobname='sepay-pull-today';
commit;
