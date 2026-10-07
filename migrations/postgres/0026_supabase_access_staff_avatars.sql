-- Bảng mới (0025): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."staff_avatars" FROM anon, authenticated;
