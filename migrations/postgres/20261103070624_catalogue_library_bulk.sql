-- Run manually once before deploying catalogue bulk actions. Never deletes source products or quote snapshots.
ALTER TABLE public.catalogue_library_products ADD COLUMN deleted_at text;
ALTER TABLE public.catalogue_library_products ADD COLUMN deleted_by text REFERENCES public.staff_members(id);
CREATE TABLE public.catalogue_library_commands (
 member_id text NOT NULL REFERENCES public.staff_members(id),client_key text NOT NULL,
 payload_hash text NOT NULL,result text,created_at text NOT NULL,PRIMARY KEY(member_id,client_key)
);
ALTER TABLE public.catalogue_library_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogue_library_commands FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.catalogue_library_commands FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.catalogue_library_commands FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.catalogue_library_commands TO service_role; END IF;
END $$;
