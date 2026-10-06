-- Bảng mới (0013): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."customer_stock_requests" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."web_push_keys" FROM anon, authenticated;
