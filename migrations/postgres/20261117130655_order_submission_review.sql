-- Nullable: historical orders keep their existing workflow until a new staff submission.
-- Operational facts only; purchase/printing costs remain in the Manager-only quote data.
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS submission_review text;
