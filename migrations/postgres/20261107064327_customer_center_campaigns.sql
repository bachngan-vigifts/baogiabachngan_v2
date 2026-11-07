-- Customer campaigns are empty until a Manager creates real assignments. No sample data.
CREATE TABLE public.customer_campaigns (
 id text PRIMARY KEY, name text NOT NULL, note text NOT NULL DEFAULT '',
 start_date text NOT NULL, end_date text NOT NULL, status text NOT NULL DEFAULT 'active',
 revision bigint NOT NULL DEFAULT 1, created_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL, updated_at text NOT NULL,
 CONSTRAINT chk_customer_campaigns_status CHECK (status IN ('draft','active','completed','cancelled')),
 CONSTRAINT chk_customer_campaigns_input CHECK (length(btrim(name)) BETWEEN 1 AND 160 AND length(note) <= 2000 AND start_date <= end_date AND revision > 0)
);
CREATE INDEX idx_customer_campaigns_dates ON public.customer_campaigns(status,start_date,end_date);
ALTER TABLE public.customer_campaigns ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.customer_campaign_targets (
 id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES public.customer_campaigns(id),
 customer_id text NOT NULL REFERENCES public.sapo_customers(id), assignee_id text NOT NULL REFERENCES public.staff_members(id),
 activity_id text REFERENCES public.customer_activities(id) ON DELETE SET NULL,
 revision bigint NOT NULL DEFAULT 1, created_at text NOT NULL, updated_at text NOT NULL,
 CONSTRAINT chk_customer_campaign_target_revision CHECK (revision > 0)
);
CREATE UNIQUE INDEX uq_customer_campaign_target ON public.customer_campaign_targets(campaign_id,customer_id);
CREATE UNIQUE INDEX uq_customer_campaign_activity ON public.customer_campaign_targets(activity_id);
CREATE INDEX idx_customer_campaign_assignee ON public.customer_campaign_targets(assignee_id,campaign_id);
ALTER TABLE public.customer_campaign_targets ENABLE ROW LEVEL SECURITY;
-- PGlite has no platform roles. Apply grants only when those roles exist.
DO $$ DECLARE target_role text; BEGIN
 FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
   EXECUTE format('REVOKE ALL ON public.customer_campaigns, public.customer_campaign_targets FROM %I',target_role);
  END IF;
 END LOOP;
 REVOKE ALL ON public.customer_campaigns, public.customer_campaign_targets FROM PUBLIC;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_campaigns, public.customer_campaign_targets TO service_role;
 END IF;
END $$;
