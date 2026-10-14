-- Bảng mới (0051): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."supplier_order_sources" FROM anon, authenticated;
REVOKE ALL ON TABLE public."supplier_receipts" FROM anon, authenticated;
REVOKE ALL ON TABLE public."supplier_receipt_lines" FROM anon, authenticated;
REVOKE ALL ON TABLE public."supplier_payment_schedules" FROM anon, authenticated;
REVOKE ALL ON TABLE public."supplier_payments" FROM anon, authenticated;
REVOKE ALL ON TABLE public."supplier_order_events" FROM anon, authenticated;
