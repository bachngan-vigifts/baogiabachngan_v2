-- Giữ hàng theo dòng đơn hàng / HĐKT CRM (docs/SO-KHO.md › Giữ hàng theo đơn, quyết định Anh Thái 28/10/2026).
-- Mỗi lần giữ tối đa = có thể bán (tồn − hàng đang giữ khác) tại kho bán: tự động lúc duyệt khi có ngày giao (hạn ngày giao + 3 ngày),
-- thủ công "Giữ thêm" (hạn 5 ngày). Chấm dứt khi xuất kho / giao xong (tiêu hao), hết hạn, huỷ giữ, huỷ đơn.
CREATE TABLE IF NOT EXISTS public.order_stock_holds (
 id text PRIMARY KEY,
 order_id text NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
 order_line_id text NOT NULL REFERENCES public.sales_order_lines(id) ON DELETE CASCADE,
 sku text NOT NULL,
 warehouse_id text NOT NULL REFERENCES public.warehouses(id),
 qty double precision NOT NULL CHECK (qty >= 0),
 source text NOT NULL CHECK (source IN ('auto','manual','conversion')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','expired','consumed')),
 expires_at text NOT NULL,
 client_key text,
 created_by text NOT NULL REFERENCES public.staff_members(id),
 created_at text NOT NULL,
 closed_by text REFERENCES public.staff_members(id),
 closed_at text,
 notified_at text,
 CHECK ((status='active' AND closed_at IS NULL) OR (status<>'active' AND closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_order_stock_holds_sku ON public.order_stock_holds(sku,warehouse_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_order_stock_holds_order ON public.order_stock_holds(order_id,status);
CREATE INDEX IF NOT EXISTS idx_order_stock_holds_line ON public.order_stock_holds(order_line_id);
CREATE INDEX IF NOT EXISTS idx_order_stock_holds_expiry ON public.order_stock_holds(status,expires_at);
-- Một lần bấm "Giữ thêm" (mã chống gửi lặp) chỉ tạo một bộ dòng giữ cho mỗi dòng đơn.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_stock_holds_key ON public.order_stock_holds(order_line_id,client_key) WHERE client_key IS NOT NULL;
ALTER TABLE public.order_stock_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_stock_holds FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.order_stock_holds FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.order_stock_holds FROM authenticated; END IF;
END $$;
-- Đơn đã có trước khi bật: giữ kiểu cũ (toàn bộ phần chưa giao) cho tới khi Manager duyệt và áp dụng kế hoạch chuyển đổi.
-- Đơn tạo sau migration mặc định 'capped' (giữ theo bảng trên).
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS hold_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.sales_orders ALTER COLUMN hold_mode SET DEFAULT 'capped';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_sales_orders_hold_mode') THEN
  ALTER TABLE public.sales_orders ADD CONSTRAINT chk_sales_orders_hold_mode CHECK (hold_mode IN ('legacy','capped'));
 END IF;
END $$;
