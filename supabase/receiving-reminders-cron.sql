-- First run at 08:00 Asia/Ho_Chi_Minh = 01:00 UTC; daytime retries catch outages and late changes. Uses existing pg_cron/pg_net and existing server token in Vault.
-- No schema, extension, permission, Sapo cron or business-data changes.
-- Deploy the API endpoint before installing this job; deployment workflow installs/replaces it by name.
do $check$
begin
  if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
    raise exception 'cron.timezone không phải UTC; cần kiểm tra lại giờ nhắc trước khi cài.';
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='sapo_sync_token' and length(decrypted_secret)>=32) then
    raise exception 'Thiếu token máy chủ trong Vault; chưa cài lịch nhắc nhận hàng.';
  end if;
end
$check$;
select cron.schedule('receiving-reminders-0800-vn','*/15 1-16 * * *',$job$
  select net.http_post(
    url := 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/tasks/receiving-reminders',
    headers := jsonb_build_object('content-type','application/json','authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='sapo_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
select jobname,schedule,active from cron.job where jobname='receiving-reminders-0800-vn';
