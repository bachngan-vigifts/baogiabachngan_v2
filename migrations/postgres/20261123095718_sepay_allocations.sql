-- Additive: detailed SePay reconciliation. Deploy API only after the read-only gate passes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE IF NOT EXISTS public.sepay_reconciliation_states (
 transaction_id text PRIMARY KEY REFERENCES public.sepay_transactions(id),
 revision bigint NOT NULL DEFAULT 0 CONSTRAINT chk_sepay_allocation_revision CHECK (revision>=0)
);
CREATE TABLE IF NOT EXISTS public.sepay_allocation_batches (
 id text PRIMARY KEY, transaction_id text NOT NULL REFERENCES public.sepay_reconciliation_states(transaction_id),
 created_by text NOT NULL REFERENCES public.staff_members(id),client_key text NOT NULL,request_hash text NOT NULL,
 expected_revision bigint NOT NULL,result text NOT NULL,created_at text NOT NULL,
 CONSTRAINT chk_sepay_batch_key CHECK (length(client_key) BETWEEN 8 AND 200 AND request_hash ~ '^[0-9a-f]{64}$' AND expected_revision>=0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sepay_allocation_client ON public.sepay_allocation_batches(created_by,client_key);
CREATE INDEX IF NOT EXISTS idx_sepay_batches_transaction ON public.sepay_allocation_batches(transaction_id);
CREATE TABLE IF NOT EXISTS public.sepay_payment_allocations (
 id text PRIMARY KEY,batch_id text NOT NULL REFERENCES public.sepay_allocation_batches(id),target_key text NOT NULL,
 order_id text REFERENCES public.sales_orders(id),web_order_id text REFERENCES public.web_store_orders(id),
 amount double precision NOT NULL,target_total double precision NOT NULL,payment_id text REFERENCES public.customer_payments(id),
 created_receipt boolean NOT NULL DEFAULT false,created_at text NOT NULL,voided_at text,voided_by text REFERENCES public.staff_members(id),void_reason text NOT NULL DEFAULT '',
 CONSTRAINT chk_sepay_allocation_amount CHECK (amount>0 AND amount<=1000000000000 AND amount=floor(amount) AND target_total>=amount),
 CONSTRAINT chk_sepay_allocation_destination CHECK ((order_id IS NOT NULL AND web_order_id IS NULL AND payment_id IS NOT NULL AND target_key='order:'||order_id) OR (order_id IS NULL AND web_order_id IS NOT NULL AND payment_id IS NULL AND NOT created_receipt AND target_key='web:'||web_order_id)),
 CONSTRAINT chk_sepay_allocation_void CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason='') OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(void_reason)>=3))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sepay_allocation_target ON public.sepay_payment_allocations(batch_id,target_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sepay_allocation_receipt ON public.sepay_payment_allocations(payment_id) WHERE payment_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sepay_alloc_order ON public.sepay_payment_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_sepay_alloc_web ON public.sepay_payment_allocations(web_order_id);
CREATE INDEX IF NOT EXISTS idx_sepay_alloc_void_actor ON public.sepay_payment_allocations(voided_by);
ALTER TABLE public.sepay_reconciliation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sepay_allocation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sepay_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sepay_reconciliation_states,public.sepay_allocation_batches,public.sepay_payment_allocations FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.sepay_reconciliation_states,public.sepay_allocation_batches,public.sepay_payment_allocations FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.sepay_reconciliation_states,public.sepay_allocation_batches,public.sepay_payment_allocations FROM service_role;
  GRANT SELECT,INSERT,UPDATE ON public.sepay_reconciliation_states,public.sepay_allocation_batches,public.sepay_payment_allocations TO service_role;
 END IF;
END $$;
COMMIT;
