-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('chk_sales_line_costs_source', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_line_costs') AND conname='chk_sales_line_costs_source' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'source = ANY')>0 AND strpos(pg_get_constraintdef(oid),'''quote''')>0 AND strpos(pg_get_constraintdef(oid),'''purchase''')>0 AND strpos(pg_get_constraintdef(oid),'''purchase_later''')>0 AND strpos(pg_get_constraintdef(oid),'''manual''')>0 AND strpos(pg_get_constraintdef(oid),'''purchase_order''')>0 AND strpos(pg_get_constraintdef(oid),'''catalog_rule''')>0))),
  ('chk_sales_line_cost_history_reason', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sales_line_cost_history') AND conname='chk_sales_line_cost_history_reason' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'reason = ANY')>0 AND strpos(pg_get_constraintdef(oid),'''create''')>0 AND strpos(pg_get_constraintdef(oid),'''amend''')>0 AND strpos(pg_get_constraintdef(oid),'''confirm''')>0 AND strpos(pg_get_constraintdef(oid),'''pos''')>0 AND strpos(pg_get_constraintdef(oid),'''pos_edit''')>0 AND strpos(pg_get_constraintdef(oid),'''adjust''')>0 AND strpos(pg_get_constraintdef(oid),'''recover''')>0)))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261115091000_historical_cost_sources.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'historical_cost_sources_ready' AS result;
