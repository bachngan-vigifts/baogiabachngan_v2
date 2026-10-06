-- Bảng chứng từ kho Sapo mới (0009): API trình duyệt không được đọc trực tiếp, chỉ Edge Function (service role) truy cập.
REVOKE ALL ON TABLE public."sapo_inventory_docs" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sapo_inventory_doc_lines" FROM anon, authenticated;
