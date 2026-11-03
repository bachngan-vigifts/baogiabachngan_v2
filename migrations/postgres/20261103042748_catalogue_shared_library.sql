-- Run manually before API/UI deployment. No local-browser products or quote snapshots are backfilled here.
CREATE TABLE public.catalogue_library_products (
 id text PRIMARY KEY, source_key text NOT NULL,
 name text NOT NULL, sku text NOT NULL DEFAULT '', brand text NOT NULL, category text NOT NULL,
 collection text NOT NULL DEFAULT '', pattern text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '',
 search text NOT NULL, data text NOT NULL, revision bigint NOT NULL DEFAULT 1 CONSTRAINT chk_catalogue_library_revision CHECK(revision>0),
 last_key text, last_hash text, last_actor text,
 created_by text NOT NULL REFERENCES public.staff_members(id),updated_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,updated_at text NOT NULL
);
CREATE UNIQUE INDEX uq_catalogue_library_source ON public.catalogue_library_products(source_key);
CREATE INDEX idx_catalogue_library_brand_category ON public.catalogue_library_products(brand,category);
CREATE INDEX idx_catalogue_library_collection ON public.catalogue_library_products(collection);
CREATE INDEX idx_catalogue_library_pattern ON public.catalogue_library_products(pattern);
CREATE INDEX idx_catalogue_library_color ON public.catalogue_library_products(color);
CREATE INDEX idx_catalogue_library_updated ON public.catalogue_library_products(updated_at,id);
DO $$ BEGIN
 CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN feature_not_supported OR undefined_file THEN
 RAISE NOTICE 'pg_trgm unavailable; shared search uses bounded fallback';
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
  PERFORM set_config('search_path','public,extensions',true);
  CREATE INDEX idx_catalogue_library_search ON public.catalogue_library_products USING gin(search gin_trgm_ops);
 END IF;
END $$;
ALTER TABLE public.catalogue_library_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogue_library_products FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.catalogue_library_products FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.catalogue_library_products FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.catalogue_library_products TO service_role; END IF;
END $$;

-- One visible catalogue quote; revisions update the existing row. Command journal stores receipts only.
CREATE TABLE public.catalogue_saved_quotes (
 id text PRIMARY KEY,quote_no text NOT NULL,title text NOT NULL,customer text NOT NULL,
 product_count bigint NOT NULL,search text NOT NULL,data text NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CONSTRAINT chk_catalogue_quotes_revision CHECK(revision>0),
 created_by text NOT NULL REFERENCES public.staff_members(id),updated_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,updated_at text NOT NULL,deleted_at text,deleted_by text REFERENCES public.staff_members(id)
);
CREATE INDEX idx_catalogue_quotes_updated ON public.catalogue_saved_quotes(updated_at,id);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
 PERFORM set_config('search_path','public,extensions',true);
 CREATE INDEX idx_catalogue_quotes_search ON public.catalogue_saved_quotes USING gin(search gin_trgm_ops);
END IF; END $$;
CREATE TABLE public.catalogue_quote_commands (
 member_id text NOT NULL REFERENCES public.staff_members(id),client_key text NOT NULL,quote_id text NOT NULL,
 payload_hash text NOT NULL,result text,created_at text NOT NULL,PRIMARY KEY(member_id,client_key)
);
CREATE INDEX idx_catalogue_quote_commands_quote ON public.catalogue_quote_commands(quote_id,created_at);
ALTER TABLE public.catalogue_saved_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_quote_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogue_saved_quotes,public.catalogue_quote_commands FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.catalogue_saved_quotes,public.catalogue_quote_commands FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.catalogue_saved_quotes,public.catalogue_quote_commands FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.catalogue_saved_quotes,public.catalogue_quote_commands TO service_role; END IF;
END $$;
