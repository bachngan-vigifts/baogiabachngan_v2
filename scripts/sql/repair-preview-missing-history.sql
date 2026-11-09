-- MANUAL MAINTENANCE ONLY. Do not add to migrations/ or deployment workflows.
-- Repair missing replay history for DDL ALREADY present in production.
-- No application DDL in the dollar-quoted payloads below is executed here.
-- Run in SQL Editor on the parent project only after reviewing the matching assert/report.
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE crm_preview_history_repair(version text PRIMARY KEY, name text, statements text[]) ON COMMIT DROP;
INSERT INTO crm_preview_history_repair(version,name,statements) VALUES
('20261019035500', 'web_store_orders', ARRAY[$preview_history_0$CREATE TABLE "web_store_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "order_no" text NOT NULL,
  "register_id" text NOT NULL REFERENCES "pos_registers"("id"),
  "status" text NOT NULL,
  "customer_name" text DEFAULT 'Khách lẻ' NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "address" text DEFAULT '' NOT NULL,
  "total" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'VND' NOT NULL,
  "payment_method" text DEFAULT '' NOT NULL,
  "lines" text DEFAULT '[]' NOT NULL,
  "ordered_at" text NOT NULL,
  "updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_store_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_store_order" ON "web_store_orders" ("source","external_id");
--> statement-breakpoint
CREATE INDEX "idx_web_store_orders_register" ON "web_store_orders" ("register_id","updated_at");
$preview_history_0$]::text[]),
('20261019043000', 'web_store_order_ghn', ARRAY[$preview_history_1$alter table "web_store_orders" add column if not exists "ghn_order_code" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_status" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_sort_code" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_fee" double precision default 0 not null;
$preview_history_1$]::text[]),
('20261022204500', 'web_order_ghn_address', ARRAY[$preview_history_2$alter table "web_store_orders" add column if not exists "ghn_address_snapshot" text default '{}' not null;
$preview_history_2$]::text[]),
('20261026042035', 'inventory_adjustment_approval', ARRAY[$preview_history_3$-- Employee adjustments are immutable requests; only Manager approval posts stock.
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
$preview_history_3$]::text[]);
DO $guard$
DECLARE item record;
BEGIN
 IF to_regclass('public.web_store_orders') IS NULL OR to_regclass('public.inventory_adjustments') IS NULL
    OR to_regclass('public.pos_registers') IS NULL OR to_regclass('public.deliveries') IS NULL THEN
  RAISE EXCEPTION 'Missing existing application tables. Stop: this file repairs history only, never creates application schema.';
 END IF;
 IF EXISTS (
  SELECT 1 FROM (VALUES
   ('web_store_orders','id'),('web_store_orders','register_id'),('web_store_orders','ghn_order_code'),
   ('web_store_orders','ghn_status'),('web_store_orders','ghn_sort_code'),('web_store_orders','ghn_fee'),
   ('web_store_orders','ghn_address_snapshot'),('web_store_orders','financial_snapshot'),
   ('inventory_adjustments','id'),('inventory_adjustments','client_key'),('inventory_adjustments','payload_hash'),
   ('inventory_adjustments','warehouse_id'),('inventory_adjustments','lines'),('inventory_adjustments','reviewed_by'),
   ('deliveries','confirmed_by'),('deliveries','confirmed_at'),('deliveries','confirmed_status')
  ) required(table_name,column_name)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
    AND c.table_name=required.table_name AND c.column_name=required.column_name)
 ) THEN RAISE EXCEPTION 'Existing schema is incomplete. No history was written.'; END IF;
 IF EXISTS (SELECT 1 FROM (VALUES
  ('web_store_orders_pkey'),('uq_web_store_order'),('idx_web_store_orders_register'),
  ('inventory_adjustments_pkey'),('inventory_adjustments_ref_no_key'),('inventory_adjustments_created_by_client_key_key'),
  ('idx_inventory_adjustments_pending'),('idx_inventory_adjustments_warehouse'),('idx_inventory_adjustments_reviewer'),('idx_deliveries_confirmed_by')
 ) required(index_name) WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname='public' AND i.indexname=required.index_name))
 THEN RAISE EXCEPTION 'Expected existing indexes/uniqueness are missing. No history was written.'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('web_store_orders','inventory_adjustments') AND NOT c.relrowsecurity)
 THEN RAISE EXCEPTION 'Existing application tables must have RLS enabled. No history was written.'; END IF;
 FOR item IN SELECT r.version FROM crm_preview_history_repair r JOIN supabase_migrations.schema_migrations h USING(version)
  WHERE h.name IS DISTINCT FROM r.name OR h.statements IS DISTINCT FROM r.statements
 LOOP RAISE EXCEPTION 'History version % already contains different SQL. Stop for review; never overwrite it.',item.version; END LOOP;
END $guard$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 SELECT version,name,statements FROM crm_preview_history_repair
 ON CONFLICT(version) DO NOTHING;
SELECT version,name FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261019035500','20261019043000','20261022204500','20261026042035') ORDER BY version;
COMMIT;
