-- Bảng mới (0022): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."customer_staff" FROM anon, authenticated;
REVOKE ALL ON TABLE public."customer_contacts" FROM anon, authenticated;
