-- Read-only gate: apply 20261117130655_order_submission_review.sql before API/UI deployment.
-- Never repair schema or modify historical orders from a deployment assertion.
DO $assert$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_attribute a
  WHERE a.attrelid=to_regclass('public.sales_orders')
    AND a.attname='submission_review' AND NOT a.attisdropped
    AND a.atttypid='pg_catalog.text'::regtype AND NOT a.attnotnull
    AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)
 ) THEN
  RAISE EXCEPTION 'Run 20261117130655_order_submission_review.sql before API deployment: sales_orders.submission_review must be nullable text without a default.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.sales_orders') AND relrowsecurity) THEN
  RAISE EXCEPTION 'Check 20261117130655_order_submission_review.sql: sales_orders RLS must remain enabled.';
 END IF;
END
$assert$;
SELECT 'order_submission_review_ready' AS result;
