-- Read only. No repair, no permission seed. Run the new migration manually after approval.
DO $$ DECLARE t text; r text; i text; spec text; col text; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_stock_checks','supplier_stock_check_lines'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Thiếu phiếu kiểm tồn NCC. Chạy 20261112104633_supplier_stock_checks.sql.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) THEN RAISE EXCEPTION 'Bảng % chưa bật RLS. Kiểm tra 20261112104633_supplier_stock_checks.sql.',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'Bảng % không được mở trực tiếp Data API. Kiểm tra 20261112104633_supplier_stock_checks.sql.',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    IF has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Quyền % trên % chưa được thu hồi. Chạy 20261112104633_supplier_stock_checks.sql.',r,t; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH i IN ARRAY ARRAY['uq_supplier_stock_checks_key','uq_supplier_stock_checks_number','idx_supplier_stock_checks_supplier_date','uq_supplier_stock_check_lines_sku'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||i) AND indisvalid) THEN RAISE EXCEPTION 'Thiếu index %. Chạy 20261112104633_supplier_stock_checks.sql.',i; END IF;
 END LOOP;
 FOREACH spec IN ARRAY ARRAY['supplier_stock_checks:id,supplier_id,check_no,needed_date,note,client_key,request_hash,revision,created_at,created_by,updated_at,responded_at,responded_by','supplier_stock_check_lines:id,check_id,sku,name,unit,requested_quantity,available_quantity,promised_date,response_note,responded_at,responded_by'] LOOP
  t=split_part(spec,':',1);
  FOREACH col IN ARRAY string_to_array(split_part(spec,':',2),',') LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=col) THEN RAISE EXCEPTION 'Thiếu cột %.%. Chạy đầy đủ 20261112104633_supplier_stock_checks.sql.',t,col; END IF;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_stock_check_lines'::regclass AND conname='chk_supplier_stock_check_response' AND contype='c' AND convalidated) THEN RAISE EXCEPTION 'Thiếu kiểm tra phản hồi. Chạy đầy đủ 20261112104633_supplier_stock_checks.sql.'; END IF;
END $$;
