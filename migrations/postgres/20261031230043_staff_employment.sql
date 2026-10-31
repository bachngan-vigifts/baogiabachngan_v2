-- Organizational labels only. Existing staff remain unassigned; never infer legal employer from role / warehouse.
-- Run manually before deploying code that reads these columns. No historical payslip changes.
ALTER TABLE public.staff_members ADD COLUMN work_company text CHECK (work_company IN ('BN','VG'));
--> statement-breakpoint
ALTER TABLE public.staff_members ADD COLUMN work_department_id text REFERENCES public.staff_departments(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.staff_members ADD COLUMN is_leader boolean NOT NULL DEFAULT false;
--> statement-breakpoint
COMMENT ON COLUMN public.staff_members.work_department_id IS 'Display/payroll department; does not change position-based data scope';
--> statement-breakpoint
COMMENT ON COLUMN public.staff_members.is_leader IS 'Organizational label only; grants no approval or administrative permissions';
