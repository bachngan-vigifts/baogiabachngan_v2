-- Bảng mới (0027): API trình duyệt không được đọc trực tiếp (lương là dữ liệu nhạy cảm), chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."hr_salary_profiles" FROM anon, authenticated;
REVOKE ALL ON TABLE public."hr_attendance" FROM anon, authenticated;
REVOKE ALL ON TABLE public."hr_adjustments" FROM anon, authenticated;
REVOKE ALL ON TABLE public."hr_payslips" FROM anon, authenticated;
