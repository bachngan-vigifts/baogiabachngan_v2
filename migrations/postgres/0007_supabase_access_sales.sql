-- Bảng bán hàng mới (0006): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."sales_orders" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sales_order_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sales_contracts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."deliveries" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."delivery_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."payment_schedules" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."customer_payments" FROM anon, authenticated;
