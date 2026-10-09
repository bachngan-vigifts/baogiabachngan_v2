-- Bảng mới (0049): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."order_progress_marks" FROM anon, authenticated;
