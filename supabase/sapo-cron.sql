-- Chỉ giữ phiên Sapo 10 phút/lần để phục vụ đẩy đơn. Đồng bộ dữ liệu tự động đã tắt.
-- Không tốn phút GitHub Actions. CHỦ DỰ ÁN tự chạy một lần trong Supabase → SQL Editor:
--   thay  DAN_MA_BI_MAT_VAO_DAY  bằng đúng giá trị secret SAPO_SYNC_TOKEN trên GitHub, rồi bấm Run.
-- Chạy lại nhiều lần an toàn (đổi mã thì chạy lại với mã mới). KHÔNG commit file này khi đã điền mã.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $vault$
declare sid uuid; tok text := 'DAN_MA_BI_MAT_VAO_DAY';
begin
  if length(tok) < 32 or tok = 'DAN_MA_BI_MAT_VAO_DAY' then raise exception 'Chưa dán mã SAPO_SYNC_TOKEN (cần 32+ ký tự).'; end if;
  select id into sid from vault.secrets where name = 'sapo_sync_token';
  if sid is null then perform vault.create_secret(tok, 'sapo_sync_token', 'Mã gọi luồng đồng bộ Sapo của baogia-v2-api');
  else perform vault.update_secret(sid, tok); end if;
end
$vault$;

-- Gọi một đường đồng bộ của Edge Function bằng mã trong Vault (chỉ dùng nội bộ, không cấp cho client).
create or replace function public.sapo_sync_call(path text, timeout_ms int default 30000) returns bigint
language sql security definer set search_path = '' as $fn$
  select net.http_post(
    url := 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/sapo/' || path,
    headers := jsonb_build_object('content-type', 'application/json', 'authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sapo_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := timeout_ms);
$fn$;
revoke all on function public.sapo_sync_call(text, int) from public, anon, authenticated;

-- Cùng tên thì pg_cron cập nhật lịch giữ phiên cũ.
select cron.schedule('sapo-keepalive', '*/10 * * * *', $job$ select public.sapo_sync_call('keepalive'); $job$);
select cron.unschedule(jobid) from cron.job where jobname = 'sapo-pull';

-- Kiểm tra: chỉ còn sapo-keepalive.
select jobname, schedule, active from cron.job where jobname like 'sapo-%' order by jobname;
