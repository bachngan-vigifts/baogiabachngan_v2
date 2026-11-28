-- Read-only release gate: refund source/override columns and their check must exist.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_refunds'
     AND column_name IN ('source_payment_id','override_reason','override_evidence','override_by'))<>4
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pos_refunds'::regclass AND conname='chk_pos_refund_override' AND convalidated) THEN
  RAISE EXCEPTION 'Run 20261128090000_refund_source_method.sql before releasing refund method rules';
 END IF;
END $$;
