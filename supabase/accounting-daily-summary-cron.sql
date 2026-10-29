-- Tóm tắt thu chi cuối ngày gửi Manager lúc 18:00 Asia/Ho_Chi_Minh = 11:00 UTC; chạy lại 11:15 / 11:30 / 11:45 để bù lỗi tạm thời
-- (endpoint chỉ gửi một lần mỗi ngày). Dùng pg_cron/pg_net và token máy chủ đã có trong Vault (như receiving-reminders-cron.sql).
-- Không thêm bảng, extension, quyền; không sửa job Sapo / GHN / nhắc nhận hàng. Deploy API trước rồi mới cài job.
do $check$
begin
  if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
    raise exception 'cron.timezone không phải UTC; cần kiểm tra lại giờ gửi trước khi cài.';
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='sapo_sync_token' and length(decrypted_secret)>=32) then
    raise exception 'Thiếu token máy chủ trong Vault; chưa cài lịch tóm tắt cuối ngày.';
  end if;
end
$check$;
select cron.schedule('accounting-daily-summary-1800-vn','*/15 11 * * *',$job$
  select net.http_post(
    url := 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/accounting/daily-summary',
    headers := jsonb_build_object('content-type','application/json','authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='sapo_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
select jobname,schedule,active from cron.job where jobname='accounting-daily-summary-1800-vn';
