-- Approved retail marker only. Existing profiles and permissions are unchanged.
ALTER TABLE public.sapo_customers ADD COLUMN is_retail boolean NOT NULL DEFAULT false;
