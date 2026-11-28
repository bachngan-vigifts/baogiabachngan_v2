-- Refunds follow the original payment channel. Record the source receipt and, when a Manager
-- refunds through a different channel, the reason, evidence and approver. Additive only:
-- existing refunds keep empty override fields and no source receipt. No money rows change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS source_payment_id text REFERENCES public.customer_payments(id);
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS override_reason text NOT NULL DEFAULT '';
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS override_evidence text NOT NULL DEFAULT '';
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS override_by text REFERENCES public.staff_members(id);
ALTER TABLE public.pos_refunds DROP CONSTRAINT IF EXISTS chk_pos_refund_override;
ALTER TABLE public.pos_refunds ADD CONSTRAINT chk_pos_refund_override CHECK (
 (override_by IS NULL AND override_reason='' AND override_evidence='')
 OR (override_by IS NOT NULL AND length(trim(override_reason))>=10 AND length(trim(override_evidence))>0 AND source_payment_id IS NULL));
CREATE INDEX IF NOT EXISTS idx_pos_refunds_source_payment ON public.pos_refunds(source_payment_id) WHERE source_payment_id IS NOT NULL;
COMMIT;
