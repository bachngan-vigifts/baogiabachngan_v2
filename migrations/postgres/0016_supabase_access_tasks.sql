-- Bảng mới (0015): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."tasks" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."task_comments" FROM anon, authenticated;
