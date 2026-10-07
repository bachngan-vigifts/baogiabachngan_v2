-- Bảng mới (0030): API trình duyệt không được đọc trực tiếp (lương là dữ liệu nhạy cảm), chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."hr_payroll_settings" FROM anon, authenticated;
REVOKE ALL ON TABLE public."hr_payroll_months" FROM anon, authenticated;
REVOKE ALL ON TABLE public."hr_payroll_inputs" FROM anon, authenticated;
