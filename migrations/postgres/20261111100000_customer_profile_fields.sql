ALTER TABLE public.sapo_customers
  ADD COLUMN payment_days integer,
  ADD COLUMN representative_contact_id text,
  ADD COLUMN reject_reason text,
  ADD COLUMN rejected_by text,
  ADD COLUMN rejected_at text;
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT fk_sapo_customers_representative FOREIGN KEY (representative_contact_id) REFERENCES public.customer_contacts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT fk_sapo_customers_rejected_by FOREIGN KEY (rejected_by) REFERENCES public.staff_members(id);
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT chk_customer_payment_days CHECK (payment_days IS NULL OR (payment_days >= 0 AND payment_days <= 3650));
--> statement-breakpoint
ALTER TABLE public.sapo_customers DROP CONSTRAINT chk_sapo_customers_approval;
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT chk_sapo_customers_approval CHECK (approval_status IN ('pending', 'approved', 'rejected'));
--> statement-breakpoint
ALTER TABLE public.sapo_customers ADD CONSTRAINT chk_customer_reject_reason CHECK (approval_status <> 'rejected' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason)) > 0 AND length(reject_reason) <= 1000 AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL));
--> statement-breakpoint
CREATE INDEX idx_sapo_customers_representative ON public.sapo_customers (representative_contact_id) WHERE representative_contact_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.customer_debt_notes (
  customer_id text PRIMARY KEY REFERENCES public.sapo_customers(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  revision bigint NOT NULL DEFAULT 1,
  updated_by text NOT NULL REFERENCES public.staff_members(id),
  updated_at text NOT NULL,
  CONSTRAINT chk_customer_debt_notes_length CHECK (length(text) <= 2000),
  CONSTRAINT chk_customer_debt_notes_revision CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE public.customer_debt_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.customer_debt_notes FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.customer_debt_notes FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.customer_debt_notes FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT ALL ON public.customer_debt_notes TO service_role; END IF;
END $$;
