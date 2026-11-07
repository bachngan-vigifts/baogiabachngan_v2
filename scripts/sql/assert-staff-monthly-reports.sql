-- Read-only gate: run 20261114090000_staff_monthly_reports.sql manually before deploying the API.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_staff_weekly_reports_period' AND conrelid=to_regclass('public.staff_weekly_reports')
   AND pg_get_constraintdef(oid) LIKE '%(-[0-9]{2})?%') THEN
  RAISE EXCEPTION 'Run 20261114090000_staff_monthly_reports.sql manually before deploying this API (monthly report period)';
 END IF;
END $$;
