-- Bảng mới (0043): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."shipping_carriers" FROM anon, authenticated;
