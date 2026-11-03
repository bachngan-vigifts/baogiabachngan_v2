-- Catalog sync updates these tables frequently; maintain statistics before 20% churn accumulates.
-- Table-local settings only: no restart, no change to global memory or connection limits.
-- Rollback: ALTER TABLE public.<table> RESET (autovacuum_vacuum_scale_factor,
--   autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.products SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 50);
ALTER TABLE public.product_prices SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 50);
ALTER TABLE public.product_stock SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 50);
