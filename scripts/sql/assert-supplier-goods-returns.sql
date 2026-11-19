-- Read-only deploy gate. Apply 20261119020633_supplier_goods_returns.sql first.
DO $$ DECLARE t text; c text; r text; n text; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_goods_returns','supplier_refunds'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Run 20261119020633_supplier_goods_returns.sql (missing %)',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) THEN RAISE EXCEPTION '% must have RLS enabled',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION '% must remain private to the CRM API',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_class pc CROSS JOIN LATERAL aclexplode(coalesce(pc.relacl,acldefault('r',pc.relowner))) a WHERE pc.oid=to_regclass('public.'||t) AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC privileges on %',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND (has_table_privilege(r,'public.'||t,'SELECT') OR has_table_privilege(r,'public.'||t,'INSERT') OR has_table_privilege(r,'public.'||t,'UPDATE') OR has_table_privilege(r,'public.'||t,'DELETE')) THEN RAISE EXCEPTION 'Unexpected direct access to % for %',t,r; END IF;
  END LOOP;
 END LOOP;
 FOR t,c IN VALUES ('incoming_shipments','refunded_amount'),('incoming_shipments','remainder_closed_at'),('incoming_shipments','remainder_close_reason'),('incoming_shipment_lines','credited_qty'),('supplier_receipt_lines','returned_good_qty'),('supplier_order_sources','cancelled_quantity') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||t) AND attname=c AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'Missing %.%',t,c; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['uq_supplier_goods_returns_key','uq_supplier_goods_returns_sapo','idx_supplier_goods_returns_order','uq_supplier_refunds_key','uq_supplier_refunds_reference','idx_supplier_refunds_order'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||n) AND indisvalid AND indisready AND (left(n,3)<>'uq_' OR indisunique)) THEN RAISE EXCEPTION 'Missing valid index %',n; END IF;
 END LOOP;
 FOR t,n IN VALUES ('incoming_shipment_lines','chk_incoming_lines_credited'),('supplier_receipt_lines','chk_receipt_lines_returned'),('supplier_order_sources','chk_supplier_order_source_cancelled'),('supplier_goods_returns','chk_supplier_goods_returns_mode'),('supplier_goods_returns','chk_supplier_goods_returns_amount'),('supplier_goods_returns','chk_supplier_goods_returns_lines'),('supplier_refunds','chk_supplier_refunds_method'),('supplier_refunds','chk_supplier_refunds_amount') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||t) AND conname=n AND convalidated) THEN RAISE EXCEPTION 'Missing validated constraint %',n; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_moves'::regclass AND conname='chk_stock_moves_kind' AND convalidated AND position('supplier_return' in pg_get_constraintdef(oid))>0)
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_moves'::regclass AND conname='chk_stock_moves_ref_type' AND convalidated AND position('supplier_return' in pg_get_constraintdef(oid))>0) THEN RAISE EXCEPTION 'Missing supplier_return ledger constraints'; END IF;
END $$;
