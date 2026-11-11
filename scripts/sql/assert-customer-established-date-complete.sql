-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('established_date date', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sapo_customers' AND column_name='established_date' AND data_type='date' AND is_nullable='YES'))),
  ('chk_customer_established_date', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sapo_customers') AND conname='chk_customer_established_date' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'established_date IS NULL')>0 AND strpos(pg_get_constraintdef(oid),'0001-01-01')>0 AND strpos(pg_get_constraintdef(oid),'9999-12-31')>0)))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261105010141_customer_established_date.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'customer_established_date_complete_ready' AS result;
