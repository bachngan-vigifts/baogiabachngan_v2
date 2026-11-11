CREATE TABLE IF NOT EXISTS sales_production_folders (
 quote_id text PRIMARY KEY REFERENCES staff_quotations(id), drive_id text NOT NULL UNIQUE, created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sales_production_files (
 id text PRIMARY KEY, quote_id text NOT NULL REFERENCES staff_quotations(id),
 quote_revision bigint NOT NULL, name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=10485760), sha256 text NOT NULL, md5 text NOT NULL,
 drive_id text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready')),
 created_by text NOT NULL REFERENCES staff_members(id), created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS production_quote_hash ON sales_production_files(quote_id,quote_revision,sha256);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sales_production_file_links (order_id text NOT NULL REFERENCES sales_orders(id), file_id text NOT NULL REFERENCES sales_production_files(id), PRIMARY KEY(order_id,file_id));
--> statement-breakpoint
ALTER TABLE sales_production_folders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_production_files ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE sales_production_file_links ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sales_production_folders,sales_production_files,sales_production_file_links FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sales_production_folders,sales_production_files,sales_production_file_links FROM authenticated; END IF;
END $$;
