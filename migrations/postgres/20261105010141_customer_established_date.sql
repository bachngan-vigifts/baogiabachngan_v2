ALTER TABLE public.sapo_customers ADD COLUMN established_date date;
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT chk_customer_established_date CHECK (established_date IS NULL OR (established_date >= DATE '0001-01-01' AND established_date <= DATE '9999-12-31'));
