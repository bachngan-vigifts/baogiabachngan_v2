-- Bảng mới (0029): API trình duyệt không được đọc trực tiếp (lương là dữ liệu nhạy cảm), chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."hr_month_inputs" FROM anon, authenticated;
