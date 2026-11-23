BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sale_admin_brand text NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='suppliers'::regclass AND conname='chk_suppliers_sale_admin_brand') THEN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_sale_admin_brand CHECK (sale_admin_brand IN ('minhlong','locknlock'));
 END IF;
END $$;
COMMIT;
