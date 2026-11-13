ALTER TABLE public.products ADD COLUMN archived_at text, ADD COLUMN archived_by text, ADD CONSTRAINT chk_products_archived_inactive CHECK (archived_at IS NULL OR active=false);
COMMENT ON COLUMN public.products.archived_at IS 'Manager removal from CRM catalog; preserve SKU/history and suppress reactivation by imports/Sapo until explicit restore.';
CREATE INDEX idx_products_archived ON public.products(archived_at) WHERE archived_at IS NOT NULL;
