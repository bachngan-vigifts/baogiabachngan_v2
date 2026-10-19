-- Manager self-approval is authorized by the server role check.
-- Delegated employees still cannot approve their own entries; RLS/grants are unchanged.
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS chk_cash_approval_actor;
