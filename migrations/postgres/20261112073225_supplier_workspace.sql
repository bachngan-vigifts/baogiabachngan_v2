-- Cổng NCC: dữ liệu do NCC công bố và chứng từ riêng. Chạy tay sau phê duyệt; không thay dữ liệu cũ.
CREATE TABLE IF NOT EXISTS public.supplier_published_stock (
 supplier_id text NOT NULL REFERENCES public.suppliers(id), sku text NOT NULL, warehouse text NOT NULL,
 on_hand double precision NOT NULL CHECK(on_hand>=0), reserved double precision NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand), incoming double precision NOT NULL DEFAULT 0 CHECK(incoming>=0),
 revision bigint NOT NULL DEFAULT 1, published_at text NOT NULL, published_by text NOT NULL, PRIMARY KEY(supplier_id,sku,warehouse)
);
CREATE TABLE IF NOT EXISTS public.supplier_portal_invoices (
 id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES public.suppliers(id), shipment_id text NOT NULL REFERENCES public.incoming_shipments(id),
 invoice_no text NOT NULL, series text NOT NULL DEFAULT '', invoice_date text NOT NULL, subtotal double precision NOT NULL CHECK(subtotal>=0), tax double precision NOT NULL CHECK(tax>=0), total double precision NOT NULL CHECK(total>0 AND abs(total-subtotal-tax)<0.01),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','verified','rejected')), note text NOT NULL DEFAULT '', client_key text NOT NULL, request_hash text NOT NULL, created_at text NOT NULL, created_by text NOT NULL, verified_at text, verified_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_portal_invoice_key ON public.supplier_portal_invoices(supplier_id,client_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_portal_invoice_number ON public.supplier_portal_invoices(supplier_id,series,invoice_no);
CREATE INDEX IF NOT EXISTS idx_supplier_portal_invoice_order ON public.supplier_portal_invoices(shipment_id);
CREATE TABLE IF NOT EXISTS public.supplier_portal_deliveries (
 id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES public.suppliers(id), shipment_id text NOT NULL REFERENCES public.incoming_shipments(id), delivery_no text NOT NULL, delivery_date text NOT NULL, note text NOT NULL DEFAULT '', client_key text NOT NULL, request_hash text NOT NULL, created_at text NOT NULL, created_by text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_portal_delivery_key ON public.supplier_portal_deliveries(supplier_id,client_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_portal_delivery_number ON public.supplier_portal_deliveries(supplier_id,delivery_no);
CREATE INDEX IF NOT EXISTS idx_supplier_portal_delivery_order ON public.supplier_portal_deliveries(shipment_id);
CREATE TABLE IF NOT EXISTS public.supplier_portal_delivery_lines (
 delivery_id text NOT NULL REFERENCES public.supplier_portal_deliveries(id) ON DELETE CASCADE, purchase_line_id text NOT NULL REFERENCES public.incoming_shipment_lines(id), quantity double precision NOT NULL CHECK(quantity>0), PRIMARY KEY(delivery_id,purchase_line_id)
);
CREATE TABLE IF NOT EXISTS public.supplier_transfer_shares (
 id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES public.suppliers(id), shipment_id text NOT NULL REFERENCES public.incoming_shipments(id), transfer_id text NOT NULL REFERENCES public.stock_transfers(id), shared_at text NOT NULL, shared_by text NOT NULL, acknowledged_at text, acknowledged_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_transfer_share ON public.supplier_transfer_shares(supplier_id,transfer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transfer_share_order ON public.supplier_transfer_shares(shipment_id);
ALTER TABLE public.supplier_published_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_transfer_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_published_stock,public.supplier_portal_invoices,public.supplier_portal_deliveries,public.supplier_portal_delivery_lines,public.supplier_transfer_shares FROM PUBLIC;
-- No direct Data API grants or policies. Access is through the existing authenticated Edge router only.
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.supplier_published_stock,public.supplier_portal_invoices,public.supplier_portal_deliveries,public.supplier_portal_delivery_lines,public.supplier_transfer_shares FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
