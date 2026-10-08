-- Bảng mới (0040): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."customer_activities" FROM anon, authenticated;
