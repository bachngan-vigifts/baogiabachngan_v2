-- Additive only. Apply before enabling durableSyncJobs / deploying the Edge entrypoint.
CREATE TABLE IF NOT EXISTS edge_sync_jobs (
 key text PRIMARY KEY, kind text NOT NULL, status text NOT NULL DEFAULT 'queued',
 state text NOT NULL DEFAULT '{}', result text NOT NULL DEFAULT '{}', token text,
 lease_until text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
 available_at text NOT NULL, updated_at text NOT NULL, attempts integer NOT NULL DEFAULT 0, error_code text
);
ALTER TABLE edge_sync_jobs ENABLE ROW LEVEL SECURITY;
-- Deliberately no client policies, grants, business-data updates, or speculative indexes.
