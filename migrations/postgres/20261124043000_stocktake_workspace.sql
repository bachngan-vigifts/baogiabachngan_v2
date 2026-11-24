-- Additive metadata for stocktake lifecycle. Existing adjustment rows and ledger stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE IF NOT EXISTS public.inventory_stocktake_states (
 adjustment_id text PRIMARY KEY REFERENCES public.inventory_adjustments(id),
 revision bigint NOT NULL DEFAULT 0 CONSTRAINT stocktake_revision_nonnegative CHECK (revision>=0),
 balanced_at text, balanced_by text REFERENCES public.staff_members(id),
 cancelled_at text, cancelled_by text REFERENCES public.staff_members(id),
 merged_into text REFERENCES public.inventory_adjustments(id),
 costs text NOT NULL DEFAULT '{}',
 CONSTRAINT stocktake_cancelled_actor_pair CHECK ((cancelled_at IS NULL)=(cancelled_by IS NULL)),
 CONSTRAINT stocktake_balanced_actor_pair CHECK ((balanced_at IS NULL)=(balanced_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_stocktake_states_balanced_by ON public.inventory_stocktake_states(balanced_by);
CREATE INDEX IF NOT EXISTS idx_stocktake_states_cancelled_by ON public.inventory_stocktake_states(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_stocktake_states_merged_into ON public.inventory_stocktake_states(merged_into);
CREATE TABLE IF NOT EXISTS public.inventory_stocktake_commands (
 id text PRIMARY KEY,actor_id text NOT NULL REFERENCES public.staff_members(id),
 client_key text NOT NULL,request_hash text NOT NULL,
 adjustment_id text NOT NULL REFERENCES public.inventory_adjustments(id),
 result text NOT NULL,created_at text NOT NULL,
 CONSTRAINT stocktake_command_key_hash CHECK (length(client_key) BETWEEN 8 AND 100 AND request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stocktake_command_actor_key ON public.inventory_stocktake_commands(actor_id,client_key);
CREATE INDEX IF NOT EXISTS idx_stocktake_commands_document ON public.inventory_stocktake_commands(adjustment_id);
ALTER TABLE public.inventory_stocktake_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stocktake_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_stocktake_states,public.inventory_stocktake_commands FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.inventory_stocktake_states,public.inventory_stocktake_commands FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.inventory_stocktake_states,public.inventory_stocktake_commands FROM service_role;
  GRANT SELECT,INSERT,UPDATE ON public.inventory_stocktake_states,public.inventory_stocktake_commands TO service_role;
 END IF;
END $$;
COMMIT;
