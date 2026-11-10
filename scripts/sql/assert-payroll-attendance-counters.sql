-- Chỉ đọc: không chạy migration, không sửa dữ liệu/quyền.
DO $assert$
DECLARE missing text[];
BEGIN
 SELECT array_agg(label ORDER BY label) INTO missing
 FROM (VALUES
  ('late_count', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_inputs' AND column_name='late_count' AND data_type='integer' AND is_nullable='NO' AND column_default IN ('0','0::integer','''0''::integer')))),
  ('leave_hours', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_inputs' AND column_name='leave_hours' AND data_type='double precision' AND is_nullable='NO' AND column_default IN ('0','0::double precision','''0''::double precision')))),
  ('chk_hr_inputs_attendance_counters', (EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.hr_payroll_inputs') AND conname='chk_hr_inputs_attendance_counters' AND contype='c' AND convalidated AND strpos(pg_get_constraintdef(oid),'late_count >= 0')>0 AND strpos(pg_get_constraintdef(oid),'late_count <= 1000')>0 AND strpos(pg_get_constraintdef(oid),'leave_hours >=')>0 AND strpos(pg_get_constraintdef(oid),'leave_hours <=')>0 AND strpos(pg_get_constraintdef(oid),'744')>0)))
 ) AS expected(label,ok) WHERE ok IS DISTINCT FROM true;
 IF coalesce(cardinality(missing),0)>0 THEN
  RAISE EXCEPTION 'Thiếu hoặc sai migration 20261105042029_payroll_attendance_counters.sql: %. Đối chiếu file và xin duyệt trước khi sửa DB.',array_to_string(missing,'; ');
 END IF;
END
$assert$;
SELECT 'payroll_attendance_counters_ready' AS result;
