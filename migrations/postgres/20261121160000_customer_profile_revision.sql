-- Chặn ghi đè hồ sơ khách hàng khi hai người cùng sửa (PUT /customers/:id).
-- profile_revision tăng 1 mỗi khi BẤT KỲ ô hồ sơ nào (các ô trong form "Sửa khách hàng") thay đổi, dù ghi từ đường nào:
-- form sửa, lưu khách từ báo giá, gộp khách trùng, AppSheet, đồng bộ Sapo, danh bạ liên hệ. Không dùng source_version của Sapo.
-- API so profile_revision người dùng đang mở với bản trong CSDL (SELECT … FOR UPDATE cùng transaction): khác → 409.
-- Thêm cột có DEFAULT hằng (PostgreSQL 11+ không viết lại bảng); trigger BEFORE UPDATE.
-- Thứ tự: chạy file này TRƯỚC khi deploy API mới (API mới đọc cột này; cổng scripts/sql/assert-customer-profile-revision.sql chặn sai thứ tự).
-- Rollback: đưa API về bản cũ (không đọc cột), rồi nếu muốn: DROP TRIGGER trg_customer_profile_revision ON public.sapo_customers;
--   DROP FUNCTION public.bump_customer_profile_revision(); ALTER TABLE public.sapo_customers DROP COLUMN profile_revision;
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.sapo_customers ADD COLUMN IF NOT EXISTS profile_revision bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sapo_customers'::regclass AND conname='chk_customer_profile_revision') THEN
  ALTER TABLE public.sapo_customers ADD CONSTRAINT chk_customer_profile_revision CHECK (profile_revision >= 0);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.bump_customer_profile_revision() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 -- Số phiên bản chỉ do trigger đặt: ghi tay giá trị khác bị bỏ qua.
 IF (NEW.name, NEW.contact, NEW.phone, NEW.email, NEW.address, NEW.tax_code, NEW.customer_code, NEW.customer_type,
     NEW.established_date, NEW.deposit_rate, NEW.payment_term, NEW.payment_days, NEW.credit_limit, NEW.is_retail)
    IS DISTINCT FROM
    (OLD.name, OLD.contact, OLD.phone, OLD.email, OLD.address, OLD.tax_code, OLD.customer_code, OLD.customer_type,
     OLD.established_date, OLD.deposit_rate, OLD.payment_term, OLD.payment_days, OLD.credit_limit, OLD.is_retail) THEN
  NEW.profile_revision := OLD.profile_revision + 1;
 ELSE
  NEW.profile_revision := OLD.profile_revision;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bump_customer_profile_revision() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_customer_profile_revision ON public.sapo_customers;
CREATE TRIGGER trg_customer_profile_revision BEFORE UPDATE ON public.sapo_customers
 FOR EACH ROW EXECUTE FUNCTION public.bump_customer_profile_revision();
COMMIT;
