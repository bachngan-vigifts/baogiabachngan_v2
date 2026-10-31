-- Manual migration only. Requires contract liquidation migration from PR #399 first.
-- No production backfill and no automatic activation of payroll policy.
ALTER TABLE public.customer_activities
 ADD COLUMN completion text,
 ADD COLUMN purpose text,
 ADD COLUMN quote_id text,
 ADD COLUMN quote_revision bigint,
 ADD COLUMN client_key text,
 ADD COLUMN intent_owner_id text REFERENCES public.staff_members(id),
 ADD COLUMN payload_hash text,
 ADD COLUMN kpi_extra_approved boolean NOT NULL DEFAULT false,
 ADD COLUMN kpi_review_reason text NOT NULL DEFAULT '',
 ADD COLUMN kpi_reviewed_by text REFERENCES public.staff_members(id),
 ADD COLUMN kpi_reviewed_at text,
 ADD CONSTRAINT chk_care_completion CHECK(completion IS NULL OR completion IN ('completed','not_completed')),
 ADD CONSTRAINT chk_care_purpose CHECK(purpose IS NULL OR purpose IN ('sales','after_sales')),
 ADD CONSTRAINT chk_care_extra CHECK(NOT kpi_extra_approved OR (kpi_reviewed_by IS NOT NULL AND length(trim(kpi_review_reason))>=5));
CREATE UNIQUE INDEX uq_care_intent ON public.customer_activities(intent_owner_id,client_key);
CREATE INDEX idx_care_kpi_month ON public.customer_activities(occurred_at);
ALTER TABLE public.hr_salary_profiles
 ADD COLUMN fixed_kpi double precision,
 ADD COLUMN contract_bonus_enabled boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT chk_hr_fixed_kpi CHECK(fixed_kpi IS NULL OR (fixed_kpi>=0 AND fixed_kpi<=10));
CREATE TABLE public.hr_contract_bonus_accounts (
 id text PRIMARY KEY,
 contract_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('star','liquidation')),
 member_id text NOT NULL REFERENCES public.staff_members(id),
 origin_month text NOT NULL,
 policy text NOT NULL,
 source text NOT NULL,
 created_at text NOT NULL
);
CREATE UNIQUE INDEX uq_hr_contract_award ON public.hr_contract_bonus_accounts(contract_id,kind);
CREATE INDEX idx_hr_contract_award_member ON public.hr_contract_bonus_accounts(member_id);
CREATE TABLE public.hr_contract_bonus_entries (
 id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES public.hr_contract_bonus_accounts(id),
 member_id text NOT NULL REFERENCES public.staff_members(id),
 month text NOT NULL,
 run_id text NOT NULL,
 amount bigint NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','paid','released')),
 reason text NOT NULL,
 detail text NOT NULL,
 created_at text NOT NULL
);
CREATE UNIQUE INDEX uq_hr_award_run ON public.hr_contract_bonus_entries(account_id,run_id);
CREATE INDEX idx_hr_award_entry_month ON public.hr_contract_bonus_entries(member_id,month);
CREATE INDEX idx_hr_award_entry_account ON public.hr_contract_bonus_entries(account_id,status);
ALTER TABLE public.hr_contract_bonus_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_contract_bonus_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_contract_bonus_accounts,public.hr_contract_bonus_entries FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.hr_contract_bonus_accounts,public.hr_contract_bonus_entries FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.hr_contract_bonus_accounts,public.hr_contract_bonus_entries FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.hr_contract_bonus_accounts,public.hr_contract_bonus_entries TO service_role; END IF;
END $$;
