-- Read-only deployment prerequisite: run the additive migration by hand before API deploy.
DO $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sepay_transactions' AND column_name='web_order_id' AND data_type='text')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_transactions'::regclass AND conname='chk_sepay_one_target' AND contype='c' AND convalidated)
    OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='sepay_transactions' AND indexname='uq_sepay_web_matched' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%web_order_id%' AND indexdef LIKE '%matched%')
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.sepay_transactions'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Chưa đủ migration SePay đối soát QR web Lock. Chạy 20261109123446_sepay_lock_web_match.sql rồi assert-sepay-web.sql.';
 END IF;
END
$assert$;
SELECT 'sepay_web_schema_ok' AS result;
