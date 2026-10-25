-- Reviewed rollout only; depends on supabase/sapo-cron.sql and its Vault-backed sapo_sync_call.
-- No secret is embedded; running this file installs a production dispatcher, so do not run in CI.
do $$ begin
  if to_regprocedure('public.sapo_sync_call(text,integer)') is null then
    raise exception 'Cần cấu hình sapo-cron.sql / Vault trước';
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='sapo_sync_token' and length(decrypted_secret)>=32) then
    raise exception 'Thiếu sapo_sync_token trong Vault';
  end if;
end $$;
select cron.schedule('sapo-supplier-receipt-dispatch','* * * * *',
  $job$ select public.sapo_sync_call('goods-receipt-jobs/dispatch',60000); $job$);
