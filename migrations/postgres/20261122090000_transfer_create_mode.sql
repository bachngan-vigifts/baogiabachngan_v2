-- Preserve the original command independently of subsequent transfer state transitions.
-- NULL means a legacy transfer: its creation mode cannot safely be inferred from current status.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS create_mode text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_transfers'::regclass AND conname='chk_stock_transfer_create_mode') THEN
  ALTER TABLE public.stock_transfers ADD CONSTRAINT chk_stock_transfer_create_mode CHECK (create_mode IN ('request','approve','ship'));
 END IF;
END $$;
COMMIT;
