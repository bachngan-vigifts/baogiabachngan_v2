-- Read-only operational check; never returns the command or Vault secret.
do $check$
begin
  if (select count(*) from cron.job where jobname='sepay-pull-today') <> 1
     or not exists(select 1 from cron.job where jobname='sepay-pull-today' and active and schedule='*/5 * * * *'
       and position('/integrations/sepay/pull' in command)>0 and position('sapo_sync_token' in command)>0) then
    raise exception 'Lịch đồng bộ SePay chưa được cài đúng hoặc chưa hoạt động.';
  end if;
end
$check$;
select 'sepay_pull_schedule_ok' as result;
