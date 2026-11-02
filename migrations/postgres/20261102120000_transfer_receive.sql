-- Điều chuyển kho 2 bước: kho đi bấm "Đã chuyển" (status 'shipped', trừ kho đi) → kho đến bấm "Nhận hàng" và nhập số lượng thực nhận từng mã.
-- Phiếu cũ giữ nguyên (status 'done' = đã chuyển một bước, coi như nhận đủ: received_qty để trống). Chạy lại an toàn.
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS shipped_by text REFERENCES public.staff_members(id);
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS shipped_at text;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS shipped_note text NOT NULL DEFAULT '';
ALTER TABLE public.stock_transfer_lines ADD COLUMN IF NOT EXISTS received_qty double precision;
--> statement-breakpoint
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS chk_stock_transfers_status;
ALTER TABLE public.stock_transfers ADD CONSTRAINT chk_stock_transfers_status
  CHECK (status IN ('pending', 'approved', 'shipped', 'done', 'rejected', 'cancelled'));
ALTER TABLE public.stock_transfer_lines DROP CONSTRAINT IF EXISTS chk_stock_transfer_lines_received;
ALTER TABLE public.stock_transfer_lines ADD CONSTRAINT chk_stock_transfer_lines_received
  CHECK (received_qty IS NULL OR (received_qty >= 0 AND received_qty <= qty));
