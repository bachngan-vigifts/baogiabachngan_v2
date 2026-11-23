CREATE TABLE IF NOT EXISTS warehouse_image_queue_state (
  id text PRIMARY KEY,
  updated_at text NOT NULL
);
ALTER TABLE warehouse_image_queue_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS warehouse_image_jobs (
  id text PRIMARY KEY,
  image_hash text NOT NULL UNIQUE,
  source text NOT NULL,
  image_payload text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  position_hint integer NOT NULL DEFAULT 0,
  callback_token_hash text,
  created_by text NOT NULL,
  started_at text,
  finished_at text,
  draft_id text,
  draft_no text,
  draft_url text,
  pxk_no text,
  warnings text NOT NULL DEFAULT '[]',
  last_error text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT chk_warehouse_image_jobs_status CHECK (status IN ('queued','processing','completed','needs_review','failed'))
);
ALTER TABLE warehouse_image_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warehouse_image_jobs_queue ON warehouse_image_jobs(status, created_at);
