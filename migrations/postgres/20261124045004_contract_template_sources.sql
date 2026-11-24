BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE IF NOT EXISTS sales_contract_template_sources (
 brand text NOT NULL CHECK (brand IN ('BN','VG')),
 document_type text NOT NULL CHECK (document_type IN ('HDKT','TAM_UNG','BBNT')),
 revision integer NOT NULL CHECK (revision > 0),
 file_key text NOT NULL, file_name text NOT NULL,
 source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
 client_key text NOT NULL, created_by text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY (brand,document_type,revision),
 CONSTRAINT uq_contract_template_sources_client UNIQUE (created_by,client_key)
);
ALTER TABLE sales_contract_template_sources ENABLE ROW LEVEL SECURITY;
COMMIT;
