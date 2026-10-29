-- Chống tạo trùng / gửi lặp sai nội dung (docs/SO-KHO.md › Chống ghi trùng):
-- 1) Lịch giao: gửi lại cùng mã chống lặp + cùng nội dung → trả chuyến cũ; cùng mã khác nội dung → 409.
-- 2) Phiếu nhận NCC: cùng mã chống lặp nhưng khác số lượng / kho / phiếu xin hàng → 409 (trước đây trả phiếu cũ).
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS client_key text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_client_key ON public.deliveries(order_id, client_key) WHERE client_key IS NOT NULL;
-- Phiếu nhận cũ không có dấu nội dung: vẫn trả phiếu cũ khi gửi lại cùng mã (như trước).
ALTER TABLE public.supplier_receipts ADD COLUMN IF NOT EXISTS request_hash text;
