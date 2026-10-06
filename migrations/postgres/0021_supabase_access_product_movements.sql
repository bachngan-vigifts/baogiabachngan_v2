-- Bảng mới (0020): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."product_movements" FROM anon, authenticated;
