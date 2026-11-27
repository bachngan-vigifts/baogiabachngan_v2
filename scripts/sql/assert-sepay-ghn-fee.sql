-- Read-only release gate: GHN fee columns, check and unique fee receipt index must exist.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sepay_payment_allocations' AND column_name IN ('ghn_fee','fee_payment_id'))<>2
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_payment_allocations'::regclass AND conname='chk_sepay_allocation_ghn_fee' AND convalidated)
  OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='sepay_payment_allocations' AND indexname='uq_sepay_allocation_fee_receipt') THEN
  RAISE EXCEPTION 'Run 20261127090000_sepay_allocation_ghn_fee.sql before releasing GHN fee reconciliation';
 END IF;
END $$;
