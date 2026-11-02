-- Read-only deployment gate. The owner applies the migration manually, never this gate.
DO $$
DECLARE col text;
BEGIN
 IF to_regclass('public.customer_cash_collections') IS NULL THEN
  RAISE EXCEPTION 'Chưa chạy migration 20261102071719_customer_cash_collections.sql; chưa triển khai API thu tiền mặt chờ Manager.';
 END IF;
 FOREACH col IN ARRAY ARRAY['id','order_id','schedule_id','request_key','amount','paid_at','reference','note','status','collected_by','created_at','confirmed_by','confirmed_at','payment_id','cancelled_by','cancelled_at','cancel_reason'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_cash_collections' AND column_name=col) THEN
   RAISE EXCEPTION 'Migration tiền mặt nhân viên giữ chưa đủ cột: %', col;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.customer_cash_collections') AND relrowsecurity) THEN
  RAISE EXCEPTION 'Bảng tiền mặt nhân viên giữ chưa bật RLS.';
 END IF;
END $$;
