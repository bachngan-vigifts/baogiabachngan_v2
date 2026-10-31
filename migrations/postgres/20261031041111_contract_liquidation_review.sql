-- Explicit Manager review of completed contractual obligations and original documents.
-- Run manually before the new API/UI. No backfill or existing contract status changes.
CREATE TABLE IF NOT EXISTS public.contract_liquidation_requests (
 id text PRIMARY KEY,
 contract_id text NOT NULL REFERENCES public.sales_contracts(id),
 client_key text NOT NULL,
 payload_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 originals_received boolean NOT NULL,
 services_completed boolean NOT NULL,
 photo_file_key text NOT NULL,
 snapshot_hash text NOT NULL,
 snapshot text NOT NULL,
 requested_by text NOT NULL REFERENCES public.staff_members(id),
 requested_at text NOT NULL,
 reviewed_by text REFERENCES public.staff_members(id),
 reviewed_at text,
 review_note text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1,
 CONSTRAINT chk_contract_liquidation_status CHECK(status IN ('pending','approved','rejected','superseded')),
 CONSTRAINT chk_contract_liquidation_evidence CHECK(originals_received AND services_completed AND length(photo_file_key)>0),
 CONSTRAINT chk_contract_liquidation_review CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_liquidation_intent ON public.contract_liquidation_requests(requested_by,client_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_liquidation_active ON public.contract_liquidation_requests(contract_id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS idx_contract_liquidation_history ON public.contract_liquidation_requests(contract_id,requested_at);
CREATE INDEX IF NOT EXISTS idx_contract_liquidation_pending ON public.contract_liquidation_requests(status,requested_at);
CREATE INDEX IF NOT EXISTS idx_contract_liquidation_requester ON public.contract_liquidation_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_contract_liquidation_reviewer ON public.contract_liquidation_requests(reviewed_by);
ALTER TABLE public.contract_liquidation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_liquidation_requests FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.contract_liquidation_requests FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.contract_liquidation_requests FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.contract_liquidation_requests TO service_role; END IF;
END $$;
