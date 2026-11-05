-- Additive only. AppSheet namespace keys live in link tables, not canonical customer IDs.
ALTER TABLE sapo_customers ADD COLUMN customer_type text;
--> statement-breakpoint
ALTER TABLE sapo_customers ADD COLUMN data_source text;
--> statement-breakpoint
ALTER TABLE sapo_customers ADD CONSTRAINT chk_customer_data_source CHECK (data_source IS NULL OR data_source IN ('appsheet', 'sapo', 'web', 'pos'));
--> statement-breakpoint
CREATE TABLE appsheet_customer_links (
  app_id text NOT NULL, table_name text NOT NULL, row_id text NOT NULL,
  customer_id text REFERENCES sapo_customers(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'active', source_created_at text, source_updated_at text NOT NULL,
  approval_raw text NOT NULL, source_json text NOT NULL, applied_json text NOT NULL, synced_at text NOT NULL,
  PRIMARY KEY (app_id, table_name, row_id),
  CONSTRAINT chk_appsheet_customer_key CHECK (length(trim(app_id)) > 0 AND length(trim(table_name)) > 0 AND length(trim(row_id)) > 0),
  CONSTRAINT chk_appsheet_customer_state CHECK (state IN ('active', 'quarantined'))
);
--> statement-breakpoint
CREATE INDEX idx_appsheet_customer_target ON appsheet_customer_links(customer_id);
--> statement-breakpoint
ALTER TABLE appsheet_customer_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE appsheet_contact_links (
  app_id text NOT NULL, table_name text NOT NULL, row_id text NOT NULL,
  contact_id text REFERENCES customer_contacts(id) ON DELETE SET NULL,
  customer_row_id text NOT NULL, source_updated_at text NOT NULL,
  source_json text NOT NULL, applied_json text NOT NULL, synced_at text NOT NULL,
  PRIMARY KEY (app_id, table_name, row_id),
  CONSTRAINT chk_appsheet_contact_key CHECK (length(trim(app_id)) > 0 AND length(trim(table_name)) > 0 AND length(trim(row_id)) > 0)
);
--> statement-breakpoint
CREATE INDEX idx_appsheet_contact_target ON appsheet_contact_links(contact_id);
--> statement-breakpoint
ALTER TABLE appsheet_contact_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE appsheet_sync_runs (
  id text PRIMARY KEY, actor_id text NOT NULL, app_id text NOT NULL, plan_hash text NOT NULL,
  summary_json text NOT NULL, created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_appsheet_runs_created ON appsheet_sync_runs(created_at);
--> statement-breakpoint
ALTER TABLE appsheet_sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON appsheet_customer_links, appsheet_contact_links, appsheet_sync_runs FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON appsheet_customer_links, appsheet_contact_links, appsheet_sync_runs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON appsheet_customer_links, appsheet_contact_links, appsheet_sync_runs FROM authenticated;
  END IF;
END $$;
-- No client RLS policies: authenticated Manager API is the only entry point.
