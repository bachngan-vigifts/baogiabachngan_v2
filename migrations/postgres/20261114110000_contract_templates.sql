-- Immutable shared HĐKT templates. Existing contracts keep their original template.
CREATE TABLE IF NOT EXISTS sales_contract_template_versions (
 brand text NOT NULL, revision integer NOT NULL, source_hash text NOT NULL,
 edits text NOT NULL, created_by text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY (brand,revision),
 CONSTRAINT chk_contract_template_brand CHECK (brand IN ('BN','VG')),
 CONSTRAINT chk_contract_template_revision CHECK (revision>0),
 CONSTRAINT chk_contract_template_payload CHECK (length(edits)<=300000 AND source_hash ~ '^[a-f0-9]{64}$')
);
ALTER TABLE sales_contract_template_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_contract_template_versions FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sales_contract_template_versions FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sales_contract_template_versions FROM authenticated; END IF;
END $$;
