-- Shared monthly payroll revenue sources; effective versions preserve historical rules.
CREATE TABLE sales_payroll_team_sources (
 effective_month text PRIMARY KEY,
 bn_register_id text NOT NULL REFERENCES pos_registers(id),
 lock_register_id text NOT NULL REFERENCES pos_registers(id),
 bonus_mode text NOT NULL,
 updated_by text NOT NULL REFERENCES staff_members(id),
 updated_at text NOT NULL,
 CONSTRAINT chk_sales_payroll_sources_month CHECK (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 CONSTRAINT chk_sales_payroll_sources_distinct CHECK (bn_register_id<>lock_register_id),
 CONSTRAINT chk_sales_payroll_sources_mode CHECK (bonus_mode IN ('threshold','tiers'))
);
CREATE INDEX idx_sales_payroll_sources_bn ON sales_payroll_team_sources(bn_register_id);
CREATE INDEX idx_sales_payroll_sources_lock ON sales_payroll_team_sources(lock_register_id);
CREATE INDEX idx_sales_payroll_sources_editor ON sales_payroll_team_sources(updated_by);
ALTER TABLE sales_payroll_team_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_payroll_team_sources FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sales_payroll_team_sources FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sales_payroll_team_sources FROM authenticated; END IF;
END $$;
