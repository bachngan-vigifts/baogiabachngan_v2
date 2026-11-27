-- GHN pays COD net of its fees. Keep the withheld fee next to the bank allocation so the
-- order is settled in full while the bank amount stays exactly what was received.
-- Additive only: existing allocations keep ghn_fee=0 and no fee receipt. No money rows change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.sepay_payment_allocations ADD COLUMN IF NOT EXISTS ghn_fee double precision NOT NULL DEFAULT 0;
ALTER TABLE public.sepay_payment_allocations ADD COLUMN IF NOT EXISTS fee_payment_id text REFERENCES public.customer_payments(id);
ALTER TABLE public.sepay_payment_allocations DROP CONSTRAINT IF EXISTS chk_sepay_allocation_ghn_fee;
ALTER TABLE public.sepay_payment_allocations ADD CONSTRAINT chk_sepay_allocation_ghn_fee
 CHECK (ghn_fee>=0 AND ghn_fee<=1000000000000 AND ghn_fee=floor(ghn_fee) AND (fee_payment_id IS NULL OR ghn_fee>0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sepay_allocation_fee_receipt ON public.sepay_payment_allocations(fee_payment_id) WHERE fee_payment_id IS NOT NULL AND voided_at IS NULL;
COMMIT;
