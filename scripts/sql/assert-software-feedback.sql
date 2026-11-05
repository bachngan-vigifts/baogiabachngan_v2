-- Read-only gate: run 20261105060000_software_feedback.sql manually before deploying the API.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['software_feedback','software_feedback_photos','software_feedback_votes','software_feedback_comments'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN RAISE EXCEPTION 'Run 20261105060000_software_feedback.sql manually before deploying this API (missing %)', tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||tbl) AND relrowsecurity) THEN RAISE EXCEPTION 'Software feedback requires RLS on %', tbl; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_software_feedback_client_key') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Software feedback requires client key uniqueness'; END IF;
END $$;
