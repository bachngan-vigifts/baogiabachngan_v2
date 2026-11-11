-- Read-only: fail deployment until the indexes were installed by hand.
DO $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='web_store_orders' AND column_name='ordered_at_verified' AND data_type='boolean' AND is_nullable='NO')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sepay_transactions' AND column_name='match_method' AND data_type='text' AND is_nullable='NO')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sepay_transactions' AND column_name='matched_order_at' AND data_type='text')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_transactions'::regclass AND conname='chk_sepay_match_method' AND contype='c' AND convalidated)
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sepay_pending_time' AND tablename='sepay_transactions' AND indexdef LIKE '%transaction_at%' AND indexdef LIKE '%payment_id%')
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_sepay_payment_link' AND tablename='sepay_transactions' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%payment_id%')
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sales_orders_created' AND tablename='sales_orders' AND indexdef LIKE '%created_at%')
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_web_orders_created' AND tablename='web_store_orders' AND indexdef LIKE '%ordered_at%')
 THEN RAISE EXCEPTION 'Chưa đủ index đối soát SePay theo thời gian. Chạy 20261109193137_sepay_proximity_indexes.sql rồi assert-sepay-proximity.sql.';
 END IF;
END
$assert$;
SELECT 'sepay_proximity_schema_ok' AS result;
