-- Ngưỡng tồn tối thiểu theo kho + mã cho báo cáo tuần của Cửa hàng trưởng ("hàng cần bổ sung"). Chỉ thêm bảng mới. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.store_restock_rules (
 warehouse_id text NOT NULL REFERENCES public.warehouses(id),
 sku text NOT NULL,
 min_qty double precision NOT NULL CONSTRAINT chk_store_restock_min CHECK (min_qty > 0 and min_qty <= 1000000000),
 updated_by text NOT NULL REFERENCES public.staff_members(id),
 updated_at text NOT NULL,
 CONSTRAINT store_restock_rules_pkey PRIMARY KEY (warehouse_id, sku)
);
--> statement-breakpoint
ALTER TABLE public.store_restock_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 REVOKE ALL ON public.store_restock_rules FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.store_restock_rules FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.store_restock_rules FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.store_restock_rules TO service_role; END IF;
END $$;
