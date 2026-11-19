-- Supplier returns preserve the original receipt, payments and purchase quantity.
-- New tables are private: access only through the authenticated CRM API.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.incoming_shipments
 ADD COLUMN refunded_amount double precision NOT NULL DEFAULT 0,
 ADD COLUMN remainder_closed_at text,
 ADD COLUMN remainder_close_reason text NOT NULL DEFAULT '';
ALTER TABLE public.incoming_shipment_lines ADD COLUMN credited_qty double precision NOT NULL DEFAULT 0,
 ADD CONSTRAINT chk_incoming_lines_credited CHECK(credited_qty>=0 AND credited_qty<=quantity);
ALTER TABLE public.supplier_receipt_lines ADD COLUMN returned_good_qty double precision NOT NULL DEFAULT 0,
 ADD CONSTRAINT chk_receipt_lines_returned CHECK(returned_good_qty>=0 AND returned_good_qty<=good_qty);
ALTER TABLE public.supplier_order_sources ADD COLUMN cancelled_quantity double precision NOT NULL DEFAULT 0,
 ADD CONSTRAINT chk_supplier_order_source_cancelled CHECK(cancelled_quantity>=0 AND cancelled_quantity<=quantity);
CREATE TABLE public.supplier_goods_returns (
 id text PRIMARY KEY, shipment_id text NOT NULL REFERENCES public.incoming_shipments(id),
 receipt_id text REFERENCES public.supplier_receipts(id), mode text NOT NULL,
 returned_date text NOT NULL, reason text NOT NULL, warehouse_id text,
 items text NOT NULL, credit_amount double precision NOT NULL DEFAULT 0,
 sapo_return_id text, sapo_return_code text NOT NULL DEFAULT '', evidence_note text NOT NULL DEFAULT '',
 client_key text NOT NULL, request_hash text NOT NULL, created_by text NOT NULL REFERENCES public.staff_members(id),created_at text NOT NULL,
 CONSTRAINT chk_supplier_goods_returns_mode CHECK(mode IN ('credit','replacement','close')),
 CONSTRAINT chk_supplier_goods_returns_amount CHECK(credit_amount>=0 AND credit_amount<'Infinity'::double precision),
 CONSTRAINT chk_supplier_goods_returns_lines CHECK(jsonb_typeof(items::jsonb)='array' AND jsonb_array_length(items::jsonb) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX uq_supplier_goods_returns_key ON public.supplier_goods_returns(client_key);
CREATE UNIQUE INDEX uq_supplier_goods_returns_sapo ON public.supplier_goods_returns(sapo_return_id);
CREATE INDEX idx_supplier_goods_returns_order ON public.supplier_goods_returns(shipment_id);
CREATE TABLE public.supplier_refunds (
 id text PRIMARY KEY,shipment_id text NOT NULL REFERENCES public.incoming_shipments(id),amount double precision NOT NULL,
 received_date text NOT NULL,method text NOT NULL,reference text NOT NULL,note text NOT NULL DEFAULT '',
 client_key text NOT NULL,request_hash text NOT NULL,created_by text NOT NULL REFERENCES public.staff_members(id),created_at text NOT NULL,
 CONSTRAINT chk_supplier_refunds_method CHECK(method IN ('transfer','cash','other')),
 CONSTRAINT chk_supplier_refunds_amount CHECK(amount>0 AND amount<=1e13)
);
CREATE UNIQUE INDEX uq_supplier_refunds_key ON public.supplier_refunds(client_key);
CREATE UNIQUE INDEX uq_supplier_refunds_reference ON public.supplier_refunds(shipment_id,method,lower(trim(reference)));
CREATE INDEX idx_supplier_refunds_order ON public.supplier_refunds(shipment_id);
ALTER TABLE public.supplier_goods_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_goods_returns,public.supplier_refunds FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.supplier_goods_returns,public.supplier_refunds FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.supplier_goods_returns,public.supplier_refunds TO service_role;
 END IF;
END $$;
ALTER TABLE public.stock_moves DROP CONSTRAINT chk_stock_moves_kind;
ALTER TABLE public.stock_moves ADD CONSTRAINT chk_stock_moves_kind CHECK(kind IN ('supplier_return','opening','receipt','issue','adjust','reverse','customer_return','sale','transfer_out','transfer_in'));
ALTER TABLE public.stock_moves DROP CONSTRAINT chk_stock_moves_ref_type;
ALTER TABLE public.stock_moves ADD CONSTRAINT chk_stock_moves_ref_type CHECK(ref_type IN ('supplier_return','opening','supplier_receipt','packing_slip','adjustment','pos_order','pos_delivery','pos_return','sales_order','stock_transfer','web_order'));
COMMIT;
