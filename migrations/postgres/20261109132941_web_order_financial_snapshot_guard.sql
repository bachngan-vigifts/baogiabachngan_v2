-- Forward-only repair: keep the original financial snapshot migration unchanged.
-- A missing table is an error: repair/replay its CREATE history first; never skip it.
-- Existing snapshots are untouched, including nonempty JSON text.
ALTER TABLE public.web_store_orders
  ADD COLUMN IF NOT EXISTS financial_snapshot text NOT NULL DEFAULT '{}';
