-- Đơn web (Lock, Minh Long) ghi sổ kho quầy theo trạng thái GHN (quyết định Anh Thái 28/10/2026, docs/SO-KHO.md › Đơn web):
-- GHN báo đã lấy hàng (hoặc trạng thái sau đó) → tự trừ kho quầy; GHN báo đã hoàn về shop → tự cộng lại đúng số đã trừ.
ALTER TABLE stock_moves DROP CONSTRAINT IF EXISTS chk_stock_moves_ref_type;
ALTER TABLE stock_moves ADD CONSTRAINT chk_stock_moves_ref_type CHECK (ref_type IN ('opening','supplier_receipt','packing_slip','adjustment','pos_order','pos_delivery','pos_return','sales_order','stock_transfer','web_order'));
-- none: chưa trừ · issued: đã trừ · returned: đã cộng lại sau hoàn · blocked: không trừ được (mã / tồn / kho) – cần đối soát
-- legacy: đơn đã lấy hàng / kết thúc trước khi bật – không tự trừ bù (đối soát qua hồ sơ, docs/DOI-SOAT-KHO-LICH-SU.md).
ALTER TABLE public.web_store_orders ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.web_store_orders ADD COLUMN IF NOT EXISTS stock_note text NOT NULL DEFAULT '';
ALTER TABLE public.web_store_orders ADD COLUMN IF NOT EXISTS stock_updated_at text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_web_store_orders_stock_status') THEN
  ALTER TABLE public.web_store_orders ADD CONSTRAINT chk_web_store_orders_stock_status CHECK (stock_status IN ('none','issued','returned','blocked','legacy'));
 END IF;
END $$;
UPDATE public.web_store_orders SET stock_status = 'legacy', stock_note = 'Đã lấy hàng / kết thúc trước khi ghi sổ kho đơn web'
WHERE stock_status = 'none' AND (lower(status) IN ('completed','cancelled','refunded','trash','failed')
  OR lower(ghn_status) IN ('picked','storing','transporting','sorting','delivering','money_collect_delivering','delivery_fail','delivered',
    'waiting_to_return','return','return_transporting','return_sorting','returning','return_fail','returned','damage','lost','exception'));
CREATE INDEX IF NOT EXISTS idx_web_store_orders_stock ON public.web_store_orders(stock_status, ghn_status);
