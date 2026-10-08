-- Bảng mới (0037): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."chat_attachments" FROM anon, authenticated;
-- Đính kèm tin nhắn: bucket private nhận thêm GIF, Excel, Word, CSV, TXT, ZIP (giới hạn 6 MB / file giữ nguyên).
UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','image/gif','application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
  'text/csv','text/plain','application/zip'
] WHERE id = 'baogiabachngan-v2-files';
