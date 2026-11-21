-- Read-only deploy gate. Apply 20261121150000_purchase_order_intents.sql first.
DO $$ DECLARE r text; n text; BEGIN
 IF to_regclass('public.purchase_order_intents') IS NULL THEN RAISE EXCEPTION 'Run 20261121150000_purchase_order_intents.sql (missing purchase_order_intents)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.purchase_order_intents'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'purchase_order_intents must have RLS enabled'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_order_intents') THEN RAISE EXCEPTION 'purchase_order_intents must remain private to the CRM API'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class pc CROSS JOIN LATERAL aclexplode(coalesce(pc.relacl,acldefault('r',pc.relowner))) a WHERE pc.oid='public.purchase_order_intents'::regclass AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC must not have privileges on purchase_order_intents'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND (has_table_privilege(r,'public.purchase_order_intents','SELECT') OR has_table_privilege(r,'public.purchase_order_intents','INSERT') OR has_table_privilege(r,'public.purchase_order_intents','UPDATE') OR has_table_privilege(r,'public.purchase_order_intents','DELETE')) THEN
   RAISE EXCEPTION '% must not access purchase_order_intents',r; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['created_by','client_key','request_hash','shipment_ids','created_at'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.purchase_order_intents'::regclass AND attname=n AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'Missing purchase_order_intents.%',n; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['pk_purchase_order_intents','chk_purchase_order_intents_key','chk_purchase_order_intents_hash','chk_purchase_order_intents_ids'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_intents'::regclass AND conname=n AND convalidated) THEN RAISE EXCEPTION 'Missing validated constraint %',n; END IF;
 END LOOP;
END $$;
