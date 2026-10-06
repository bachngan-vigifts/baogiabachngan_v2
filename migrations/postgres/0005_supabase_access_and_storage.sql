INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('baogiabachngan-v2-files', 'baogiabachngan-v2-files', false, 6291456, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
 IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
 END IF;
END $$;
