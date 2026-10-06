-- Bảng tài khoản khách hàng mới (0011): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."customer_accounts" FROM anon, authenticated;
