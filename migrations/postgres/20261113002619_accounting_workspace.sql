-- Independent fiscal subledgers. No physical warehouse, inventory, invoice or historical row is rewritten.
CREATE TABLE IF NOT EXISTS public.accounting_entities (
 id text PRIMARY KEY,name text NOT NULL,tax_code text NOT NULL,
 reference_k numeric(12,4),k_source text NOT NULL DEFAULT '',k_verified_date text,
 slow_days bigint NOT NULL DEFAULT 90,coverage_days bigint NOT NULL DEFAULT 180,import_ratio numeric(12,4) NOT NULL DEFAULT 3,
 revision bigint NOT NULL DEFAULT 1,created_by text NOT NULL REFERENCES public.staff_members(id),created_at text NOT NULL,updated_at text NOT NULL,
 CONSTRAINT ck_accounting_entity_tax CHECK(tax_code ~ '^[0-9]{10}([0-9]{3})?$'),
 CONSTRAINT ck_accounting_reference_k CHECK(reference_k IS NULL OR (reference_k>0 AND reference_k<>'NaN'::numeric AND length(k_source)>0 AND k_verified_date IS NOT NULL)),
 CONSTRAINT ck_accounting_policy CHECK(slow_days>0 AND coverage_days>0 AND import_ratio>0 AND import_ratio<>'NaN'::numeric)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_entity_tax ON public.accounting_entities(tax_code);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.accounting_books (
 id text PRIMARY KEY,name text NOT NULL,entity_id text REFERENCES public.accounting_entities(id),invoice_provider text CHECK(invoice_provider IN ('viettel','vnpt')),opening_date text,
 revision bigint NOT NULL DEFAULT 1,active boolean NOT NULL DEFAULT true,
 created_by text REFERENCES public.staff_members(id),created_at text NOT NULL,updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_book_name ON public.accounting_books(name);
CREATE INDEX IF NOT EXISTS idx_accounting_book_entity ON public.accounting_books(entity_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.accounting_documents (
 id text PRIMARY KEY,book_id text NOT NULL REFERENCES public.accounting_books(id),entity_id text NOT NULL REFERENCES public.accounting_entities(id),
 kind text NOT NULL,state text NOT NULL DEFAULT 'draft',date text NOT NULL,reference text NOT NULL,series text NOT NULL DEFAULT '',counterparty_tax_code text NOT NULL DEFAULT '',
 source_order_id text REFERENCES public.sales_orders(id),source_revision bigint,related_id text,
 note text NOT NULL DEFAULT '',revision bigint NOT NULL DEFAULT 1,created_by text NOT NULL REFERENCES public.staff_members(id),created_at text NOT NULL,
 posted_by text REFERENCES public.staff_members(id),posted_at text,void_reason text,
 CONSTRAINT ck_accounting_document_kind CHECK(kind IN ('opening','purchase','sale','purchase_return','sale_return')),
 CONSTRAINT ck_accounting_document_state CHECK(state IN ('draft','posted','voided')),
 CONSTRAINT ck_accounting_document_date CHECK(date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 CONSTRAINT ck_accounting_posted CHECK(state<>'posted' OR (posted_by IS NOT NULL AND posted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_accounting_document_book_date ON public.accounting_documents(book_id,date);
CREATE INDEX IF NOT EXISTS idx_accounting_document_entity_date ON public.accounting_documents(entity_id,date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_document_reference ON public.accounting_documents(entity_id,kind,series,reference,counterparty_tax_code) WHERE state<>'voided';
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_source_order ON public.accounting_documents(source_order_id) WHERE state<>'voided';
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_book_opening ON public.accounting_documents(book_id) WHERE kind='opening' AND state='posted';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.accounting_lines (
 document_id text NOT NULL REFERENCES public.accounting_documents(id),line_no bigint NOT NULL,
 sku text NOT NULL,name text NOT NULL,unit text NOT NULL,quantity numeric(18,3) NOT NULL,net_value bigint NOT NULL,carrying_value bigint,tax_rate numeric(7,4),source_line_id text,
 PRIMARY KEY(document_id,line_no),
 CONSTRAINT ck_accounting_line_qty CHECK(quantity>0 AND quantity<>'NaN'::numeric AND net_value>=0 AND net_value<=9000000000000 AND (carrying_value IS NULL OR (carrying_value>=0 AND carrying_value<=9000000000000))),
 CONSTRAINT ck_accounting_line_tax CHECK(tax_rate IS NULL OR (tax_rate>=0 AND tax_rate<=100))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.accounting_periods (
 entity_id text NOT NULL REFERENCES public.accounting_entities(id),month text NOT NULL,reference text NOT NULL,
 verified_by text NOT NULL REFERENCES public.staff_members(id),verified_at text NOT NULL,
 PRIMARY KEY(entity_id,month),CONSTRAINT ck_accounting_month CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE TABLE IF NOT EXISTS public.accounting_reviews (
 fingerprint text PRIMARY KEY,entity_id text NOT NULL REFERENCES public.accounting_entities(id),status text NOT NULL,note text NOT NULL,
 updated_by text NOT NULL REFERENCES public.staff_members(id),updated_at text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 CONSTRAINT ck_accounting_review_status CHECK(status IN ('open','investigating','resolved'))
);
CREATE INDEX IF NOT EXISTS idx_accounting_review_entity ON public.accounting_reviews(entity_id);
--> statement-breakpoint
-- App sessions are verified by the Edge API, not Supabase Auth JWT policies. Deny direct Data API access.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_entities','accounting_books','accounting_documents','accounting_lines','accounting_periods','accounting_reviews'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t); END IF;
 END LOOP;
END $$;

--> statement-breakpoint
-- Owner-approved names; system provisioning has no staff actor. No legal entity, balance or physical warehouse is inferred.
INSERT INTO public.accounting_books(id,name,invoice_provider,created_at,updated_at) VALUES
 ('accounting-vigifts','Kho tổng Vigifts','viettel',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text),
 ('accounting-bach-ngan','Kho tổng Bách Ngân','vnpt',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
ON CONFLICT DO NOTHING;
