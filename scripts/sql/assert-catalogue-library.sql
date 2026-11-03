-- Read-only gate: run migration manually before API and UI deployment.
DO $$ DECLARE col text; BEGIN
 IF to_regclass('public.catalogue_library_products') IS NULL THEN RAISE EXCEPTION 'Run 20261103042748_catalogue_shared_library.sql before deploying shared catalogue'; END IF;
 FOREACH col IN ARRAY ARRAY['id','source_key','name','sku','brand','category','collection','pattern','color','search','data','revision','last_key','last_hash','last_actor','created_by','updated_by','created_at','updated_at'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='catalogue_library_products' AND column_name=col) THEN RAISE EXCEPTION 'Shared catalogue migration missing column: %',col; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.catalogue_library_products'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Shared catalogue requires RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_catalogue_library_source') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Shared catalogue requires valid source uniqueness'; END IF;
END $$;

DO $$ DECLARE tbl text; col text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['catalogue_saved_quotes','catalogue_quote_commands'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Shared catalogue missing table: %',tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Shared catalogue requires RLS on %',tbl; END IF;
 END LOOP;
 FOREACH col IN ARRAY ARRAY['id','quote_no','title','customer','product_count','search','data','revision','created_by','updated_by','created_at','updated_at','deleted_at','deleted_by'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='catalogue_saved_quotes' AND column_name=col) THEN RAISE EXCEPTION 'Shared quotes missing column: %',col; END IF;
 END LOOP;
 FOREACH col IN ARRAY ARRAY['member_id','client_key','quote_id','payload_hash','result','created_at'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='catalogue_quote_commands' AND column_name=col) THEN RAISE EXCEPTION 'Shared quote journal missing column: %',col; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.catalogue_quote_commands'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (member_id, client_key)') THEN RAISE EXCEPTION 'Shared quote command key missing'; END IF;
END $$;
