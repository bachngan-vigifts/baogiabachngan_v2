-- Separate handling responsibility from immutable creator / revenue assignee.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.staff_quotations ADD COLUMN IF NOT EXISTS support_assignee_id text REFERENCES public.staff_members(id) ON DELETE SET NULL;
ALTER TABLE public.staff_quotations ADD COLUMN IF NOT EXISTS support_assignment_revision bigint NOT NULL DEFAULT 0;
