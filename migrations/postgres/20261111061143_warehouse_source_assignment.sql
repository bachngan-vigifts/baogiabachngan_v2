-- Additive assignment metadata. No existing task, inventory or payroll rows are rewritten.
CREATE TABLE IF NOT EXISTS public.warehouse_work_assignments (
 task_id text PRIMARY KEY REFERENCES public.tasks(id), operation_key text NOT NULL UNIQUE,
 mode text NOT NULL CHECK(mode IN ('single','team')), lead_id text NOT NULL REFERENCES public.staff_members(id), warehouse_id text NOT NULL,
 prepared boolean NOT NULL DEFAULT false, request_hash text NOT NULL DEFAULT '', reason text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1, created_by text REFERENCES public.staff_members(id), created_at text NOT NULL, updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.warehouse_work_source_links (
 task_id text PRIMARY KEY REFERENCES public.tasks(id), assignment_id text NOT NULL REFERENCES public.warehouse_work_assignments(task_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_source_assignment ON public.warehouse_work_source_links(assignment_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.warehouse_work_parts (
 task_id text PRIMARY KEY REFERENCES public.tasks(id), assignment_id text NOT NULL REFERENCES public.warehouse_work_assignments(task_id),
 member_id text NOT NULL REFERENCES public.staff_members(id), part text NOT NULL, share double precision NOT NULL CHECK(share>0 AND share<=1),
 UNIQUE(assignment_id,member_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_parts_assignment ON public.warehouse_work_parts(assignment_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_parts_member ON public.warehouse_work_parts(member_id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_work_assignments','warehouse_work_source_links','warehouse_work_parts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t); END IF;
 END LOOP;
END $$;
