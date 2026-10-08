-- Bảng mới (0046): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."web_push_attempts" FROM anon, authenticated;
