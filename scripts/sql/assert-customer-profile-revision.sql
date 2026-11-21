-- Read-only deploy gate. Apply 20261121160000_customer_profile_revision.sql first (the API reads sapo_customers.profile_revision).
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.sapo_customers'::regclass AND attname='profile_revision' AND attnum>0 AND NOT attisdropped AND attnotnull) THEN
  RAISE EXCEPTION 'Run 20261121160000_customer_profile_revision.sql (missing sapo_customers.profile_revision)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sapo_customers'::regclass AND conname='chk_customer_profile_revision' AND convalidated) THEN
  RAISE EXCEPTION 'Missing validated constraint chk_customer_profile_revision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.sapo_customers'::regclass AND t.tgname='trg_customer_profile_revision'
   AND NOT t.tgisinternal AND t.tgenabled='O' AND p.proname='bump_customer_profile_revision') THEN
  RAISE EXCEPTION 'Missing enabled trigger trg_customer_profile_revision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='bump_customer_profile_revision' AND pronamespace='public'::regnamespace AND position('profile_revision' in prosrc)>0 AND position('is_retail' in prosrc)>0) THEN
  RAISE EXCEPTION 'bump_customer_profile_revision does not cover the profile fields'; END IF;
END $$;
