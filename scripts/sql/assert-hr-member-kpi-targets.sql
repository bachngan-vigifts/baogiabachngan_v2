DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_salary_profiles' AND column_name IN ('kpi_new_customers_target','kpi_transactions_target','kpi_contracts_target')) <> 3 THEN
   RAISE EXCEPTION 'Run 20261105030000_hr_member_kpi_targets.sql manually before deploying this API';
 END IF;
END $$;
