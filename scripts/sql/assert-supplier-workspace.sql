-- Read only. Run migrations/postgres/20261112073225_supplier_workspace.sql manually before deployment.
DO $$ DECLARE t text; r text; idx text; spec text; col text; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_published_stock','supplier_portal_invoices','supplier_portal_deliveries','supplier_portal_delivery_lines','supplier_transfer_shares'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Thiếu cấu trúc cổng NCC (%). Chạy 20261112073225_supplier_workspace.sql trước khi deploy.',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) THEN RAISE EXCEPTION 'Bảng % chưa bật RLS. Kiểm tra 20261112073225_supplier_workspace.sql.',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'Bảng % không được mở policy Data API; chỉ truy cập qua router NCC.',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    IF has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Quyền Data API của % trên % chưa được thu hồi. Chạy lại migration cổng NCC.',r,t; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH idx IN ARRAY ARRAY['uq_supplier_portal_invoice_key','uq_supplier_portal_invoice_number','idx_supplier_portal_invoice_order','uq_supplier_portal_delivery_key','uq_supplier_portal_delivery_number','idx_supplier_portal_delivery_order','uq_supplier_transfer_share','idx_supplier_transfer_share_order'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||idx) AND indisvalid) THEN RAISE EXCEPTION 'Thiếu index hợp lệ %. Chạy 20261112073225_supplier_workspace.sql.',idx; END IF;
 END LOOP;
 FOREACH spec IN ARRAY ARRAY[
  'supplier_published_stock:supplier_id,sku,warehouse,on_hand,reserved,incoming,revision,published_at,published_by',
  'supplier_portal_invoices:id,supplier_id,shipment_id,invoice_no,series,invoice_date,subtotal,tax,total,status,note,client_key,request_hash,created_at,created_by,verified_at,verified_by',
  'supplier_portal_deliveries:id,supplier_id,shipment_id,delivery_no,delivery_date,note,client_key,request_hash,created_at,created_by',
  'supplier_portal_delivery_lines:delivery_id,purchase_line_id,quantity',
  'supplier_transfer_shares:id,supplier_id,shipment_id,transfer_id,shared_at,shared_by,acknowledged_at,acknowledged_by'
 ] LOOP
  t=split_part(spec,':',1);
  FOREACH col IN ARRAY string_to_array(split_part(spec,':',2),',') LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=col) THEN RAISE EXCEPTION 'Thiếu cột %.%. Chạy đầy đủ 20261112073225_supplier_workspace.sql.',t,col; END IF;
  END LOOP;
 END LOOP;
END $$;
