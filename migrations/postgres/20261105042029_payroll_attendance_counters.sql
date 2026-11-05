-- Monthly attendance counters: retained for review; no new monetary policy.
ALTER TABLE hr_payroll_inputs
  ADD COLUMN IF NOT EXISTS late_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_hours double precision NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hr_payroll_inputs'::regclass AND conname = 'chk_hr_inputs_attendance_counters') THEN
    ALTER TABLE hr_payroll_inputs ADD CONSTRAINT chk_hr_inputs_attendance_counters
      CHECK (late_count BETWEEN 0 AND 1000 AND leave_hours >= 0 AND leave_hours <= 744);
  END IF;
END $$;
