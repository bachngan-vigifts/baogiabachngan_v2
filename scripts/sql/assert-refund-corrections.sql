-- Read-only release gate: refund void columns, correction table, its unique keys and RLS must exist.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_refunds'
     AND column_name IN ('voided_at','voided_by','void_reason','replaced_by_refund_id'))<>4
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pos_refunds'::regclass AND conname='chk_pos_refund_void' AND convalidated)
  OR to_regclass('public.pos_refund_corrections') IS NULL
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.pos_refund_corrections'::regclass)
  OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='pos_refund_corrections' AND indexname IN ('uq_refund_correction_key','uq_refund_correction_refund'))<>2 THEN
  RAISE EXCEPTION 'Run 20261128100000_refund_corrections.sql before releasing refund corrections';
 END IF;
END $$;
