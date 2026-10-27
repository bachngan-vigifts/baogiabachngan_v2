-- Stable early-request numbers: PXH_NNN_DDMMYYYY, dated in Vietnam.
-- IDs, receipt provenance, quantities and all existing source links stay unchanged.
ALTER TABLE public.purchase_early_requests ADD COLUMN IF NOT EXISTS ticket_number text NOT NULL DEFAULT '';

-- Preserve assigned numbers on repeat deploys. Include deleted parents so numbers are never reused.
WITH dated AS (
 SELECT id, created_at, ticket_number,
   to_char(created_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','DDMMYYYY') AS stamp
 FROM public.purchase_early_requests
), maxima AS (
 SELECT stamp, max(CASE WHEN ticket_number ~ ('^PXH_[0-9]{3,}_' || stamp || '$')
   THEN split_part(ticket_number,'_',2)::bigint END) AS last_no
 FROM dated GROUP BY stamp
), ranked AS (
 SELECT d.id, d.stamp, (coalesce(m.last_no,0) + row_number() OVER (PARTITION BY d.stamp ORDER BY d.created_at::timestamptz,d.id))::text AS seq
 FROM dated d JOIN maxima m USING(stamp) WHERE d.ticket_number=''
)
UPDATE public.purchase_early_requests r
SET ticket_number='PXH_' || lpad(n.seq,greatest(3,length(n.seq)),'0') || '_' || n.stamp
FROM ranked n WHERE r.id=n.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_early_requests_number
 ON public.purchase_early_requests(ticket_number) WHERE ticket_number<>'';

-- Deferred until commit: create and split both finish source/purchase locks BEFORE the number lock.
-- This also numbers requests created by the previous API during a rolling deployment.
CREATE OR REPLACE FUNCTION public.assign_early_request_number() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE stamp text; seq text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.purchase_early_requests WHERE id=NEW.id AND ticket_number='') THEN
   RETURN NEW;
 END IF;
 stamp := pg_catalog.to_char(NEW.created_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','DDMMYYYY');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('early-request-number:' || stamp));
 SELECT (coalesce(max(pg_catalog.split_part(ticket_number,'_',2)::bigint),0)+1)::text INTO seq
 FROM public.purchase_early_requests WHERE ticket_number ~ ('^PXH_[0-9]{3,}_' || stamp || '$');
 UPDATE public.purchase_early_requests
 SET ticket_number='PXH_' || pg_catalog.lpad(seq,greatest(3,pg_catalog.length(seq)),'0') || '_' || stamp
 WHERE id=NEW.id AND ticket_number='';
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_early_request_number() FROM PUBLIC;
DROP TRIGGER IF EXISTS assign_early_request_number ON public.purchase_early_requests;
CREATE CONSTRAINT TRIGGER assign_early_request_number
 AFTER INSERT ON public.purchase_early_requests DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.assign_early_request_number();
