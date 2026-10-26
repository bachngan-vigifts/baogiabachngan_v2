-- Employee adjustments are immutable requests; only Manager approval posts stock.
CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
 id text PRIMARY KEY,
 ref_no text NOT NULL UNIQUE,
 client_key text NOT NULL,
 payload_hash text NOT NULL,
 warehouse_id text NOT NULL REFERENCES public.warehouses(id),
 reason text NOT NULL,
 lines text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 created_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,
 reviewed_by text REFERENCES public.staff_members(id),
 reviewed_at text,
 review_note text NOT NULL DEFAULT '',
 UNIQUE(created_by,client_key),
 CHECK(jsonb_typeof(lines::jsonb)='array' AND jsonb_array_length(lines::jsonb) BETWEEN 1 AND 300),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_pending ON public.inventory_adjustments(status,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_warehouse ON public.inventory_adjustments(warehouse_id,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_reviewer ON public.inventory_adjustments(reviewed_by);
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_adjustments FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.inventory_adjustments FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.inventory_adjustments FROM authenticated; END IF;
END $$;
-- Actual last manual confirmation; old records stay unknown rather than crediting the creator.
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS confirmed_by text REFERENCES public.staff_members(id);
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS confirmed_at text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS confirmed_status text;
CREATE INDEX IF NOT EXISTS idx_deliveries_confirmed_by ON public.deliveries(confirmed_by);
