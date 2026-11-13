-- Private staging only: no physical stock mutations or automatic ledger approval.
CREATE TABLE IF NOT EXISTS public.accounting_import_jobs (
 id text PRIMARY KEY,owner_id text NOT NULL REFERENCES public.staff_members(id),
 book_id text NOT NULL REFERENCES public.accounting_books(id),entity_id text NOT NULL REFERENCES public.accounting_entities(id),
 file_hash text NOT NULL,filename text NOT NULL,total_rows integer NOT NULL,kind text NOT NULL,date text NOT NULL,
 reference text NOT NULL,note text NOT NULL,policy_id text NOT NULL,policy_name text NOT NULL,state text NOT NULL DEFAULT 'uploading',
 document_id text REFERENCES public.accounting_documents(id),created_at text NOT NULL,updated_at text NOT NULL,
 CONSTRAINT ck_accounting_import_job CHECK(total_rows BETWEEN 1 AND 30000 AND kind IN ('opening','purchase','sale') AND state IN ('uploading','completed','cancelled') AND file_hash ~ '^[a-f0-9]{64}$' AND ((state='completed')=(document_id IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS idx_accounting_import_owner_book ON public.accounting_import_jobs(owner_id,book_id);
CREATE TABLE IF NOT EXISTS public.accounting_import_chunks (
 job_id text NOT NULL REFERENCES public.accounting_import_jobs(id),chunk_no integer NOT NULL,hash text NOT NULL,
 row_count integer NOT NULL,error_count integer NOT NULL,created_at text NOT NULL,PRIMARY KEY(job_id,chunk_no),
 CONSTRAINT ck_accounting_import_chunk CHECK(chunk_no BETWEEN 0 AND 59 AND row_count BETWEEN 1 AND 500 AND error_count BETWEEN 0 AND row_count)
);
CREATE TABLE IF NOT EXISTS public.accounting_import_rows (
 job_id text NOT NULL REFERENCES public.accounting_import_jobs(id),line_no integer NOT NULL,source_row integer NOT NULL,sku text NOT NULL,raw_quantity text NOT NULL,
 quantity numeric(18,3),name text NOT NULL DEFAULT '',unit text NOT NULL DEFAULT '',unit_price double precision,net_value bigint,
 error text NOT NULL DEFAULT '',priced_at text NOT NULL,PRIMARY KEY(job_id,line_no),
 CONSTRAINT ck_accounting_import_row CHECK(line_no BETWEEN 1 AND 30000 AND source_row>1)
);
CREATE INDEX IF NOT EXISTS idx_accounting_import_sku ON public.accounting_import_rows(job_id,sku);
ALTER TABLE public.accounting_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_import_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_import_jobs,public.accounting_import_chunks,public.accounting_import_rows FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.accounting_import_jobs,public.accounting_import_chunks,public.accounting_import_rows FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.accounting_import_jobs,public.accounting_import_chunks,public.accounting_import_rows FROM authenticated; END IF;
END $$;
