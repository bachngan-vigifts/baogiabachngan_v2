-- Bảng mới (0035): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."packing_slips" FROM anon, authenticated;
REVOKE ALL ON TABLE public."packing_slip_lines" FROM anon, authenticated;
REVOKE ALL ON TABLE public."packing_slip_photos" FROM anon, authenticated;
