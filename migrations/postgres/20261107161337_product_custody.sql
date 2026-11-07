-- Manual migration only. Custody records never write stock movements, revenue or debt.
CREATE TABLE IF NOT EXISTS public.product_custody_tickets (
 id text PRIMARY KEY, ticket_number text NOT NULL, kind text NOT NULL, status text NOT NULL,
 customer_id text REFERENCES public.sapo_customers(id), supplier_id text REFERENCES public.suppliers(id), party_name text NOT NULL,
 responsible_id text NOT NULL REFERENCES public.staff_members(id), created_by text NOT NULL REFERENCES public.staff_members(id),
 start_date text NOT NULL, due_date text NOT NULL, sent_date text, returned_date text, delivered_date text,
 issue text NOT NULL DEFAULT '', result text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1,
 client_key text NOT NULL, fingerprint text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 CONSTRAINT chk_custody_kind CHECK (kind IN ('warranty','sample')),
 CONSTRAINT chk_custody_status CHECK (status IN ('pending','sent','processing','borrowed','returned','delivered','completed')),
 CONSTRAINT chk_custody_revision CHECK (revision>0),
 CONSTRAINT chk_custody_party CHECK ((kind='sample' AND customer_id IS NOT NULL AND supplier_id IS NULL AND status IN ('borrowed','returned','completed')) OR (kind='warranty' AND supplier_id IS NOT NULL AND status IN ('pending','sent','processing','returned','delivered','completed'))),
 CONSTRAINT chk_custody_dates CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$' AND due_date ~ '^\d{4}-\d{2}-\d{2}$' AND start_date::date::text=start_date AND due_date::date::text=due_date AND due_date>=start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custody_number ON public.product_custody_tickets(ticket_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custody_client ON public.product_custody_tickets(created_by,client_key);
CREATE INDEX IF NOT EXISTS idx_custody_responsible_due ON public.product_custody_tickets(responsible_id,due_date);
CREATE INDEX IF NOT EXISTS idx_custody_creator ON public.product_custody_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_custody_status_due ON public.product_custody_tickets(status,due_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.product_custody_lines (
 id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES public.product_custody_tickets(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES public.products(sku), name text NOT NULL, unit text NOT NULL, qty double precision NOT NULL,
 returned_qty double precision NOT NULL DEFAULT 0, condition_out text NOT NULL,
 CONSTRAINT chk_custody_qty CHECK (qty>0 AND qty<=1000000000 AND returned_qty>=0 AND returned_qty<=qty)
);
CREATE INDEX IF NOT EXISTS idx_custody_lines_ticket ON public.product_custody_lines(ticket_id);
CREATE INDEX IF NOT EXISTS idx_custody_lines_sku ON public.product_custody_lines(sku,ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custody_line_sku ON public.product_custody_lines(ticket_id,sku);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.product_custody_events (
 id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES public.product_custody_tickets(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES public.staff_members(id), action text NOT NULL, date text NOT NULL,
 at text NOT NULL, note text NOT NULL, data text NOT NULL, client_key text NOT NULL, fingerprint text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custody_events_ticket ON public.product_custody_events(ticket_id,at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custody_event_client ON public.product_custody_events(actor_id,client_key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.product_custody_photos (
 id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES public.product_custody_tickets(id) ON DELETE CASCADE,
 storage_key text NOT NULL, created_by text NOT NULL REFERENCES public.staff_members(id), created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custody_photos_ticket ON public.product_custody_photos(ticket_id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['product_custody_tickets','product_custody_lines','product_custody_events','product_custody_photos'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t); END IF;
 END LOOP;
END $$;
--> statement-breakpoint
-- Independent module switch; preserve custom positions until a manager grants it.
INSERT INTO public.staff_position_permissions(position_id,permission)
SELECT id,'page.product-custody' FROM public.staff_positions
WHERE id IN ('sale','sale-admin','sales-ml','sales-lock','accounting','warehouse')
ON CONFLICT(position_id,permission) DO NOTHING;
