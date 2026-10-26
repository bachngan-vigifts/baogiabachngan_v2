-- Keep the request and its sourcing history; only hide it from operational flows.
ALTER TABLE public.purchase_early_requests ADD COLUMN IF NOT EXISTS deleted_at text;
ALTER TABLE public.purchase_early_requests ADD COLUMN IF NOT EXISTS deleted_by text REFERENCES public.staff_members(id);
CREATE INDEX IF NOT EXISTS idx_purchase_early_requests_deleted_by ON public.purchase_early_requests(deleted_by);
ALTER TABLE public.supplier_receipts ADD COLUMN IF NOT EXISTS create_sapo boolean NOT NULL DEFAULT true;
