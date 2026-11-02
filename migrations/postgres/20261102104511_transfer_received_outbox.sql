-- Disabled until Manager explicitly activates after n8n / destination configuration is ready.
-- No historical jobs or stock moves are created by this migration.
ALTER TABLE public.stock_transfer_lines ADD COLUMN IF NOT EXISTS received_qty double precision;
ALTER TABLE public.stock_transfer_lines ADD COLUMN IF NOT EXISTS shipped_qty double precision;
ALTER TABLE public.stock_transfer_lines DROP CONSTRAINT IF EXISTS chk_stock_transfer_lines_shipped;
ALTER TABLE public.stock_transfer_lines ADD CONSTRAINT chk_stock_transfer_lines_shipped CHECK
 (shipped_qty IS NULL OR (shipped_qty > 0 AND shipped_qty <= qty AND (received_qty IS NULL OR received_qty <= shipped_qty)));
CREATE TABLE IF NOT EXISTS public.stock_transfer_integration_settings (
 id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, integration_activated_at text, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stock_transfer_outbox (
 idempotency_key text PRIMARY KEY, transfer_id text NOT NULL UNIQUE REFERENCES public.stock_transfers(id),
 payload_hash text NOT NULL, payload text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_transfer_outbox_status CHECK (status IN ('pending','claimed','succeeded','manual','conflict','unknown','failed')),
 attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT chk_transfer_outbox_attempts CHECK (attempt_count >= 0),
 dispatch_token text, dispatch_until text, next_attempt_at text NOT NULL,
 claim_token text, claimed_at text, processed_at text,
 destination_system text, destination_id text, destination_no text, destination_url text,
 last_error text NOT NULL DEFAULT '', created_at text NOT NULL, updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfer_outbox_due ON public.stock_transfer_outbox(status,next_attempt_at);
ALTER TABLE public.stock_transfer_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_outbox ENABLE ROW LEVEL SECURITY;
INSERT INTO public.stock_transfer_integration_settings(id,enabled,updated_at)
 VALUES ('stock_transfer_received_v1',false,now()::text) ON CONFLICT(id) DO NOTHING;
-- No public/browser access policies; only backend database role may use these tables.
REVOKE ALL ON public.stock_transfer_outbox,public.stock_transfer_integration_settings FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON public.stock_transfer_outbox,public.stock_transfer_integration_settings FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON public.stock_transfer_outbox,public.stock_transfer_integration_settings FROM authenticated;
 END IF;
END $$;
