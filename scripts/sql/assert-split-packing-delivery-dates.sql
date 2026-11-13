-- Read-only gate for 20261113074715_split_packing_delivery_dates.sql.
-- No backfill, migration replay or scheduling changes are performed here.
DO $$
DECLARE r regclass:=to_regclass('public.packing_slips'); col text; definition text;
BEGIN
 IF r IS NULL THEN RAISE EXCEPTION 'Apply 20261113074715_split_packing_delivery_dates.sql: missing packing_slips'; END IF;
 FOREACH col IN ARRAY ARRAY['plan_source','planned_delivery_date'] LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packing_slips'
    AND column_name=col AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
   RAISE EXCEPTION 'Incomplete 20261113074715_split_packing_delivery_dates.sql: nullable text column %',col;
  END IF;
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid=r
  AND conname='chk_packing_plan_source' AND contype='c' AND convalidated;
 IF definition IS NULL OR definition NOT LIKE '%plan_source IS NULL%'
  OR definition NOT LIKE '%stock%' OR definition NOT LIKE '%transfer%'
  OR definition NOT LIKE '%purchase%' OR definition NOT LIKE '%incoming%' THEN
  RAISE EXCEPTION 'Incomplete 20261113074715_split_packing_delivery_dates.sql: plan_source constraint';
 END IF;
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid=r
  AND conname='chk_packing_planned_delivery_date' AND contype='c' AND convalidated;
 IF definition IS NULL OR definition NOT LIKE '%planned_delivery_date IS NULL%'
  OR definition NOT LIKE '%~%' OR definition NOT LIKE '%::date%'
  OR definition NOT LIKE '%::text%' OR definition NOT LIKE '%= planned_delivery_date%' THEN
  RAISE EXCEPTION 'Incomplete 20261113074715_split_packing_delivery_dates.sql: delivery date constraint';
 END IF;
END $$;
