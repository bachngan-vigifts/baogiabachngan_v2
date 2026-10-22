create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.ghn_pos_lock_sync_call(timeout_ms int default 120000) returns bigint
language sql security definer set search_path = '' as $fn$
  select net.http_post(
    url := 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/ghn/pos-lock/pull',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sapo_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := timeout_ms);
$fn$;
revoke all on function public.ghn_pos_lock_sync_call(int) from public, anon, authenticated;

select cron.schedule('ghn-pos-lock-pull', '*/5 * * * *', $job$ select public.ghn_pos_lock_sync_call(); $job$);
