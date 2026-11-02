-- Tiền mặt nhân viên giữ: chỉ tạo customer_payments khi Manager xác nhận đã thực nhận.
-- Không chuyển đổi hoặc thay đổi bất kỳ phiếu thu cũ nào. Chủ dự án chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.customer_cash_collections (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES public.sales_orders(id),
 schedule_id text REFERENCES public.payment_schedules(id) ON DELETE SET NULL, request_key text NOT NULL,
 amount double precision NOT NULL CHECK (amount>0), paid_at text NOT NULL,
 reference text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','confirmed','cancelled')),
 collected_by text NOT NULL REFERENCES public.staff_members(id), created_at text NOT NULL,
 confirmed_by text REFERENCES public.staff_members(id), confirmed_at text,
 payment_id text REFERENCES public.customer_payments(id),
 cancelled_by text REFERENCES public.staff_members(id), cancelled_at text, cancel_reason text NOT NULL DEFAULT '',
 CONSTRAINT chk_customer_cash_collection_confirmation CHECK ((status='confirmed')=(confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND payment_id IS NOT NULL)),
 CONSTRAINT chk_customer_cash_collection_cancellation CHECK ((status='cancelled')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(cancel_reason)>=3))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_cash_collection_key ON public.customer_cash_collections(request_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_cash_collection_payment ON public.customer_cash_collections(payment_id);
CREATE INDEX IF NOT EXISTS idx_customer_cash_collections_order ON public.customer_cash_collections(order_id,status);
ALTER TABLE public.customer_cash_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_cash_collections FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.customer_cash_collections FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.customer_cash_collections FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT ALL ON public.customer_cash_collections TO service_role; END IF;
END $$;
