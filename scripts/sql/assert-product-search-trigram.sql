-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
-- pg_trgm phải có trên production; PGlite không có extension này nên test thiếu extension phải thất bại.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('pg_trgm', (EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm'))),
  ('idx_products_search_fold_trgm', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_products_search_fold_trgm' AND i.indrelid=to_regclass('public.products') AND i.indisvalid AND i.indisready AND a.amname='gin' AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indexprs IS NOT NULL AND strpos(pg_get_indexdef(i.indexrelid),'gin_trgm_ops')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(sku')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(name')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(brand')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(pattern')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'translate(lower(')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'''aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd''')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'translate(lower(')=1))),
  ('idx_products_search_compact_trgm', (EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public' AND x.relname='idx_products_search_compact_trgm' AND i.indrelid=to_regclass('public.products') AND i.indisvalid AND i.indisready AND a.amname='gin' AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indexprs IS NOT NULL AND strpos(pg_get_indexdef(i.indexrelid),'gin_trgm_ops')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(sku')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(name')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(brand')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'COALESCE(pattern')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'translate(lower(')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'''aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd''')>0 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'regexp_replace(')=1 AND strpos(pg_get_expr(i.indexprs,i.indrelid),'''[^a-z0-9]''')>0)))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261103095218_product_search_trigram.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'product_search_trigram_ready' AS result;
