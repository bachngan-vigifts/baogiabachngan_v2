-- Read-only release gate: the legacy amount<=order-total check would reject customer credits.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
 WHERE conrelid='public.sepay_payment_allocations'::regclass AND conname='chk_sepay_allocation_amount' AND convalidated;
 IF definition IS NULL OR definition !~ 'target_total >= .*0' OR definition ~ 'target_total >= amount' THEN
  RAISE EXCEPTION 'Run 20261125113000_sepay_allocation_overpayment.sql before releasing SePay differences';
 END IF;
END $$;
