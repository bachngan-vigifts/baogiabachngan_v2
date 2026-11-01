-- Read-only schema gate: never apply the business owner's manual migration implicitly.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_members'
        AND ((column_name = 'work_company' AND data_type = 'text')
          OR (column_name = 'work_department_id' AND data_type = 'text')
          OR (column_name = 'is_leader' AND data_type = 'boolean'))) <> 3 THEN
    RAISE EXCEPTION 'Missing staff employment schema. Run migrations/postgres/20261031230043_staff_employment.sql manually before deploying API.';
  END IF;
END $$;
