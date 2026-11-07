-- Giá vốn dòng đơn lưu lúc bán (snapshot) + lịch sử điều chỉnh – căn cứ Phân tích lợi nhuận giai đoạn 2. Chỉ thêm bảng mới.
-- Chạy tay trước khi triển khai API (mọi luồng tạo / sửa đơn ghi vào bảng này). Chạy lại không đổi gì.
CREATE TABLE IF NOT EXISTS public.sales_line_costs (
 order_line_id text PRIMARY KEY REFERENCES public.sales_order_lines(id) ON DELETE CASCADE,
 order_id text NOT NULL REFERENCES public.sales_orders(id),
 sku text NOT NULL,
 unit_cost double precision NOT NULL CONSTRAINT chk_sales_line_costs_unit_cost CHECK (unit_cost >= 0),
 source text NOT NULL CONSTRAINT chk_sales_line_costs_source CHECK (source IN ('quote','purchase','purchase_later','manual')),
 confidence text NOT NULL CONSTRAINT chk_sales_line_costs_confidence CHECK (confidence IN ('confirmed','estimate','backfill')),
 cost_at text,
 captured_at text NOT NULL,
 captured_by text REFERENCES public.staff_members(id),
 revision integer NOT NULL DEFAULT 1,
 note text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_line_costs_order ON public.sales_line_costs(order_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.sales_line_cost_history (
 id text PRIMARY KEY,
 order_line_id text NOT NULL,
 order_id text NOT NULL,
 sku text NOT NULL,
 unit_cost double precision,
 previous_unit_cost double precision,
 source text NOT NULL,
 confidence text NOT NULL,
 reason text NOT NULL CONSTRAINT chk_sales_line_cost_history_reason CHECK (reason IN ('create','amend','confirm','pos','pos_edit','adjust')),
 note text NOT NULL DEFAULT '',
 actor_id text,
 at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_line_cost_history_line ON public.sales_line_cost_history(order_line_id, at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_line_cost_history_order ON public.sales_line_cost_history(order_id);
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['sales_line_costs','sales_line_cost_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', tbl); END IF;
 END LOOP;
END $$;
