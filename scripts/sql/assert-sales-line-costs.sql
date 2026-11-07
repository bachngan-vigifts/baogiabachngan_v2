-- Read-only gate: run 20261115090000_sales_line_costs.sql manually before deploying the API (order flows write cost snapshots).
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['sales_line_costs','sales_line_cost_history'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Run 20261115090000_sales_line_costs.sql manually before deploying this API (missing %)', tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Sales line costs require RLS on %', tbl; END IF;
 END LOOP;
END $$;
