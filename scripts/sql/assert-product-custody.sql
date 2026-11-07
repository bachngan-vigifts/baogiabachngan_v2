-- Read-only gate: run 20261107161337_product_custody.sql manually before API deployment.
DO $$ DECLARE required record; col text; idx text; relation regclass; BEGIN
 FOR required IN SELECT * FROM (VALUES
 ('product_custody_tickets',ARRAY['id','ticket_number','kind','status','customer_id','supplier_id','party_name','responsible_id','created_by','start_date','due_date','sent_date','returned_date','delivered_date','issue','result','note','revision','client_key','fingerprint','created_at','updated_at']),
 ('product_custody_lines',ARRAY['id','ticket_id','sku','name','unit','qty','returned_qty','condition_out']),
 ('product_custody_events',ARRAY['id','ticket_id','actor_id','action','date','at','note','data','client_key','fingerprint']),
 ('product_custody_photos',ARRAY['id','ticket_id','storage_key','created_by','created_at'])
 ) AS expected(table_name,columns) LOOP
  relation:=to_regclass('public.'||required.table_name);
  IF relation IS NULL THEN RAISE EXCEPTION 'Run 20261107161337_product_custody.sql manually: missing %',required.table_name; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relrowsecurity) THEN RAISE EXCEPTION 'RLS is required on %',required.table_name; END IF;
  FOREACH col IN ARRAY required.columns LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attname=col AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'Missing custody column %.%',required.table_name,col; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'anon must not access %',required.table_name; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AND has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'authenticated must not access %',required.table_name; END IF;
 END LOOP;
 FOREACH idx IN ARRAY ARRAY['uq_custody_number','uq_custody_client','uq_custody_event_client','uq_custody_line_sku'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||idx) AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Missing valid unique index %',idx; END IF;
 END LOOP;
END $$;
