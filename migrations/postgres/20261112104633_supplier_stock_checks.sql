-- Phiếu yêu cầu NCC kiểm từng mã. Chạy tay sau phê duyệt; không sửa tồn, công nợ hoặc chứng từ cũ.
CREATE TABLE IF NOT EXISTS public.supplier_stock_checks (
 id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES public.suppliers(id), check_no text NOT NULL,
 needed_date text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', client_key text NOT NULL, request_hash text NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_at text NOT NULL, created_by text NOT NULL,
 updated_at text NOT NULL, responded_at text, responded_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_stock_checks_key ON public.supplier_stock_checks(supplier_id,client_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_stock_checks_number ON public.supplier_stock_checks(supplier_id,check_no);
CREATE INDEX IF NOT EXISTS idx_supplier_stock_checks_supplier_date ON public.supplier_stock_checks(supplier_id,created_at);
CREATE TABLE IF NOT EXISTS public.supplier_stock_check_lines (
 id text PRIMARY KEY, check_id text NOT NULL REFERENCES public.supplier_stock_checks(id) ON DELETE CASCADE,
 sku text NOT NULL, name text NOT NULL, unit text NOT NULL DEFAULT '', requested_quantity double precision NOT NULL CHECK(requested_quantity>0),
 available_quantity double precision CHECK(available_quantity>=0), promised_date text NOT NULL DEFAULT '', response_note text NOT NULL DEFAULT '',
 responded_at text, responded_by text,
 CONSTRAINT chk_supplier_stock_check_response CHECK ((available_quantity IS NULL AND responded_at IS NULL AND responded_by IS NULL AND promised_date='') OR (available_quantity IS NOT NULL AND responded_at IS NOT NULL AND responded_by IS NOT NULL AND (available_quantity=0 OR promised_date~'^\d{4}-\d{2}-\d{2}$')))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_stock_check_lines_sku ON public.supplier_stock_check_lines(check_id,sku);
ALTER TABLE public.supplier_stock_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_stock_check_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_stock_checks,public.supplier_stock_check_lines FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.supplier_stock_checks,public.supplier_stock_check_lines FROM %I',r);
  END IF;
 END LOOP;
END $$;
