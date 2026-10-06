-- Bảng mới (0018): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."chat_conversations" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."chat_members" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."chat_messages" FROM anon, authenticated;
