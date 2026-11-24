BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE products ADD COLUMN IF NOT EXISTS category text NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS collection text NULL;
COMMIT;
