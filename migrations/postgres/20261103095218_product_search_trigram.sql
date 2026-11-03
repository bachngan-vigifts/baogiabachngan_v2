-- Exact expressions used by matchProductWords/foldSql, including decomposed Vietnamese marks.
-- pg_trgm is already installed in production. PGlite does not bundle it.
-- No data rewrite, no search semantic change. Rollback: DROP INDEX the two named indexes.
SET LOCAL lock_timeout = '2s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_products_search_fold_trgm ON public.products USING gin ((translate(lower(coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' || coalesce("brand", '') || ' ' || coalesce("pattern", '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ̛̣̀́̂̃̆̉', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_products_search_compact_trgm ON public.products USING gin ((regexp_replace(translate(lower(coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' || coalesce("brand", '') || ' ' || coalesce("pattern", '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ̛̣̀́̂̃̆̉', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'), '[^a-z0-9]', '', 'g')) gin_trgm_ops);
  END IF;
END $$;
