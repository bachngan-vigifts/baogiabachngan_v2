-- Warehouse workspace: only additive metadata. Existing tasks, inventory and payroll are not rewritten.
CREATE TABLE IF NOT EXISTS public.warehouse_work_settings (
 id text PRIMARY KEY, created_at text NOT NULL, calendar text NOT NULL, bonus_budget double precision CHECK(bonus_budget>=0), revision integer NOT NULL DEFAULT 1, updated_by text REFERENCES public.staff_members(id), updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.warehouse_work_runs (
 task_id text PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE, member_id text REFERENCES public.staff_members(id),
 kind text NOT NULL CONSTRAINT chk_warehouse_work_kind CHECK(kind IN ('manual','picking','packing','receiving','transfer','stocktake')),
 stage text NOT NULL DEFAULT 'todo' CONSTRAINT chk_warehouse_work_stage CHECK(stage IN ('todo','working','blocked','submitted','confirmed')),
 weight double precision NOT NULL CHECK(weight>0 AND weight<=10000), standard_minutes double precision NOT NULL CHECK(standard_minutes>0 AND standard_minutes<=100000),
 calendar text NOT NULL, due_at text NOT NULL, started_at text, submitted_at text, confirmed_at text, confirmed_by text REFERENCES public.staff_members(id), quality text CHECK(quality IN ('clean','error')),
 waits text NOT NULL DEFAULT '[]', evidence text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1, updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_warehouse_work_member_due ON public.warehouse_work_runs(member_id,due_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.warehouse_work_months (
 member_id text NOT NULL REFERENCES public.staff_members(id), month text NOT NULL, snapshot text NOT NULL, approved_by text NOT NULL REFERENCES public.staff_members(id), approved_at text NOT NULL, PRIMARY KEY(member_id,month)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_work_settings','warehouse_work_runs','warehouse_work_months'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t); END IF;
 END LOOP;
END $$;
