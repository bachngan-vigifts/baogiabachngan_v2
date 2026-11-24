DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name IN ('category','collection') AND data_type='text' AND is_nullable='YES') <> 2 THEN
  RAISE EXCEPTION 'Run product_classification_fields migration: missing nullable products.category/collection';
 END IF;
END $$;
