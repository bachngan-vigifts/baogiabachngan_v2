-- Read-only gate. Apply 20261109050000_sepay_transactions.sql manually before deploying.
DO $$
DECLARE col text;
BEGIN
 IF to_regclass('public.sepay_transactions') IS NULL THEN
  RAISE EXCEPTION 'Chưa chạy migration 20261109050000_sepay_transactions.sql.';
 END IF;
 FOREACH col IN ARRAY ARRAY['id','provider_id','transfer_type','amount','account_number','transaction_at','content','status','reason','order_id','payment_id','payload','received_at'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sepay_transactions' AND column_name=col) THEN
   RAISE EXCEPTION 'Bảng SePay thiếu cột: %', col;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
   WHERE i.indrelid='public.sepay_transactions'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND a.attname='provider_id') THEN
  RAISE EXCEPTION 'SePay thiếu chỉ mục chống trùng provider_id.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.sepay_transactions'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Bảng SePay chưa bật RLS.';
 END IF;
END $$;
