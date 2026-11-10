-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('chk_hr_payslips_month', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_payslips') AND conname='chk_hr_payslips_month' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'month ~')>0 AND strpos(pg_get_constraintdef(oid),'^[0-9]{4}-(0[1-9]|1[0-2])$')>0))),
  ('idx_sales_orders_report_date', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_sales_orders_report_date' AND i.indrelid=to_regclass('public.sales_orders') AND i.indisvalid AND i.indisready AND a.amname='btree' AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='order_date' AND pg_get_expr(i.indpred,i.indrelid)='(status = ANY (ARRAY[''confirmed''::text, ''delivering''::text, ''delivered''::text]))')))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261104000000_internal_reports.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'internal_reports_ready' AS result;
