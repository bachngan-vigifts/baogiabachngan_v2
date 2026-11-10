-- Additive dispatch metadata; existing jobs and approved month snapshots are untouched.
-- queued_at marks only jobs explicitly submitted to the new rewarded dispatch queue.
ALTER TABLE public.warehouse_work_settings ADD COLUMN IF NOT EXISTS auto_dispatch boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.warehouse_work_runs ADD COLUMN IF NOT EXISTS queued_at text;
--> statement-breakpoint
ALTER TABLE public.warehouse_work_runs ADD COLUMN IF NOT EXISTS offered_at text;
