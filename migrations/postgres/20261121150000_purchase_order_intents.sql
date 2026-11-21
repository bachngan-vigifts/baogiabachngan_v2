-- Chống tạo trùng đơn mua NCC khi gửi lại (POST /purchase-orders).
-- Mỗi lần lập đơn, giao diện gửi một mã thao tác (client_key) ổn định theo người dùng. Máy chủ lưu băm nội dung và
-- bộ ID đơn đã tạo, trong cùng transaction tạo đơn. Gửi lại cùng mã + cùng nội dung → trả bộ ID cũ; khác nội dung → 409.
-- Chỉ THÊM bảng mới; không đổi bảng / dữ liệu cũ. API chấp nhận yêu cầu chưa có mã (giao diện cũ) như trước.
-- Rollback: API cũ không đọc bảng này; có thể để nguyên hoặc DROP TABLE public.purchase_order_intents.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE IF NOT EXISTS public.purchase_order_intents (
 created_by text NOT NULL REFERENCES public.staff_members(id),
 client_key text NOT NULL,
 request_hash text NOT NULL,
 shipment_ids text NOT NULL,
 created_at text NOT NULL,
 CONSTRAINT pk_purchase_order_intents PRIMARY KEY (created_by, client_key),
 CONSTRAINT chk_purchase_order_intents_key CHECK (length(client_key) BETWEEN 8 AND 200),
 CONSTRAINT chk_purchase_order_intents_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 CONSTRAINT chk_purchase_order_intents_ids CHECK (jsonb_typeof(shipment_ids::jsonb) = 'array' AND jsonb_array_length(shipment_ids::jsonb) BETWEEN 1 AND 20)
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_intents_created ON public.purchase_order_intents(created_at);
ALTER TABLE public.purchase_order_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_intents FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.purchase_order_intents FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_order_intents TO service_role;
 END IF;
END $$;
COMMIT;
