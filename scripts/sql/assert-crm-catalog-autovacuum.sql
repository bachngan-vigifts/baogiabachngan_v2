-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('products', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.products') AND relkind='r'))),
  ('products.autovacuum_vacuum_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.products') AND o.option_name='autovacuum_vacuum_scale_factor' AND o.option_value::numeric=0.05))),
  ('products.autovacuum_vacuum_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.products') AND o.option_name='autovacuum_vacuum_threshold' AND o.option_value::numeric=50))),
  ('products.autovacuum_analyze_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.products') AND o.option_name='autovacuum_analyze_scale_factor' AND o.option_value::numeric=0.02))),
  ('products.autovacuum_analyze_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.products') AND o.option_name='autovacuum_analyze_threshold' AND o.option_value::numeric=50))),
  ('product_prices', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.product_prices') AND relkind='r'))),
  ('product_prices.autovacuum_vacuum_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_prices') AND o.option_name='autovacuum_vacuum_scale_factor' AND o.option_value::numeric=0.05))),
  ('product_prices.autovacuum_vacuum_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_prices') AND o.option_name='autovacuum_vacuum_threshold' AND o.option_value::numeric=50))),
  ('product_prices.autovacuum_analyze_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_prices') AND o.option_name='autovacuum_analyze_scale_factor' AND o.option_value::numeric=0.02))),
  ('product_prices.autovacuum_analyze_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_prices') AND o.option_name='autovacuum_analyze_threshold' AND o.option_value::numeric=50))),
  ('product_stock', (EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.product_stock') AND relkind='r'))),
  ('product_stock.autovacuum_vacuum_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_stock') AND o.option_name='autovacuum_vacuum_scale_factor' AND o.option_value::numeric=0.05))),
  ('product_stock.autovacuum_vacuum_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_stock') AND o.option_name='autovacuum_vacuum_threshold' AND o.option_value::numeric=50))),
  ('product_stock.autovacuum_analyze_scale_factor', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_stock') AND o.option_name='autovacuum_analyze_scale_factor' AND o.option_value::numeric=0.02))),
  ('product_stock.autovacuum_analyze_threshold', (EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o WHERE c.oid=to_regclass('public.product_stock') AND o.option_name='autovacuum_analyze_threshold' AND o.option_value::numeric=50)))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261103094412_crm_catalog_autovacuum.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'crm_catalog_autovacuum_ready' AS result;
