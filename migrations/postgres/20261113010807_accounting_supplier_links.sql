-- Additive, explicit reconciliation only. Does not alter stock, invoices or payable balances.
CREATE TABLE IF NOT EXISTS public.accounting_supplier_links (
 id text PRIMARY KEY,
 document_id text NOT NULL REFERENCES public.accounting_documents(id),
 invoice_id text NOT NULL REFERENCES public.supplier_portal_invoices(id),
 supplier_id text NOT NULL REFERENCES public.suppliers(id),
 shipment_id text NOT NULL REFERENCES public.incoming_shipments(id),
 shared boolean NOT NULL DEFAULT false,
 created_by text NOT NULL REFERENCES public.staff_members(id),created_at text NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 revoked_at text,revoked_by text REFERENCES public.staff_members(id),reason text NOT NULL DEFAULT '',
 CHECK(revoked_at IS NULL OR (revoked_by IS NOT NULL AND length(reason)>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_supplier_document ON public.accounting_supplier_links(document_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_supplier_invoice ON public.accounting_supplier_links(invoice_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_supplier_scope ON public.accounting_supplier_links(supplier_id,shipment_id) WHERE revoked_at IS NULL;
ALTER TABLE public.accounting_supplier_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_supplier_links FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.accounting_supplier_links FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.accounting_supplier_links FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.accounting_supplier_links TO service_role; END IF;
END $$;
