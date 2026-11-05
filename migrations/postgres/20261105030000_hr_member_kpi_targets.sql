-- Chỉ tiêu KPI riêng từng nhân viên trong hồ sơ lương (KH mới, giao dịch, số HĐ / tháng).
-- NULL = theo mức chung ở Thiết lập lương của tháng (giữ nguyên mọi hồ sơ / phiếu cũ). Không ghi lại dữ liệu cũ; chạy lại không đổi gì.
ALTER TABLE public.hr_salary_profiles ADD COLUMN IF NOT EXISTS kpi_new_customers_target double precision;
--> statement-breakpoint
ALTER TABLE public.hr_salary_profiles ADD COLUMN IF NOT EXISTS kpi_transactions_target double precision;
--> statement-breakpoint
ALTER TABLE public.hr_salary_profiles ADD COLUMN IF NOT EXISTS kpi_contracts_target double precision;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_hr_kpi_targets' AND conrelid = 'public.hr_salary_profiles'::regclass) THEN
    ALTER TABLE public.hr_salary_profiles ADD CONSTRAINT chk_hr_kpi_targets CHECK (
      (kpi_new_customers_target IS NULL OR kpi_new_customers_target > 0)
      AND (kpi_transactions_target IS NULL OR kpi_transactions_target > 0)
      AND (kpi_contracts_target IS NULL OR kpi_contracts_target > 0));
  END IF;
END $$;
