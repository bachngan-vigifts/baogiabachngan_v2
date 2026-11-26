-- Explicitly reconciled bank receipts may exceed the order total: retain the customer's credit.
-- Apply before the API/UI change. No money or historical rows are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.sepay_payment_allocations DROP CONSTRAINT IF EXISTS chk_sepay_allocation_amount;
ALTER TABLE public.sepay_payment_allocations ADD CONSTRAINT chk_sepay_allocation_amount
 CHECK (amount>0 AND amount<=1000000000000 AND amount=floor(amount) AND target_total>=0);
COMMIT;
