-- Manager corrections of a refund (wrong method or wrong voucher): void the refund and its single
-- drawer entry, optionally replace it with the right one, all in one transaction with a full trail.
-- Additive only: existing refunds stay active (voided_at null). No money rows change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS voided_at text;
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS voided_by text REFERENCES public.staff_members(id);
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS void_reason text NOT NULL DEFAULT '';
ALTER TABLE public.pos_refunds ADD COLUMN IF NOT EXISTS replaced_by_refund_id text REFERENCES public.pos_refunds(id);
ALTER TABLE public.pos_refunds DROP CONSTRAINT IF EXISTS chk_pos_refund_void;
ALTER TABLE public.pos_refunds ADD CONSTRAINT chk_pos_refund_void CHECK (
 (voided_at IS NULL AND voided_by IS NULL AND void_reason='' AND replaced_by_refund_id IS NULL)
 OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(void_reason))>=10));
CREATE TABLE IF NOT EXISTS public.pos_refund_corrections (
 id text PRIMARY KEY,
 refund_id text NOT NULL REFERENCES public.pos_refunds(id),
 action text NOT NULL,
 replacement_refund_id text REFERENCES public.pos_refunds(id),
 reason text NOT NULL,
 before_snapshot text NOT NULL,
 after_snapshot text NOT NULL,
 created_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,
 request_key text NOT NULL,
 request_hash text NOT NULL,
 CONSTRAINT chk_refund_correction_action CHECK (action IN ('void','change_method')),
 CONSTRAINT chk_refund_correction_shape CHECK ((action='void' AND replacement_refund_id IS NULL) OR (action='change_method' AND replacement_refund_id IS NOT NULL)),
 CONSTRAINT chk_refund_correction_reason CHECK (length(trim(reason))>=10),
 CONSTRAINT chk_refund_correction_key CHECK (length(request_key) BETWEEN 8 AND 200 AND request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_correction_key ON public.pos_refund_corrections(request_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_correction_refund ON public.pos_refund_corrections(refund_id);
ALTER TABLE public.pos_refund_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_refund_corrections FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE public.pos_refund_corrections FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE public.pos_refund_corrections FROM authenticated; END IF;
END $$;
COMMIT;
