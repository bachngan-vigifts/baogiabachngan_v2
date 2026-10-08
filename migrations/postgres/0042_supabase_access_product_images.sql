-- Kho ảnh sản phẩm: bucket PUBLIC product-images (ảnh sản phẩm không bí mật; trình duyệt đọc trực tiếp, có CORS,
-- nên PDF / Excel báo giá chèn được ảnh). Ảnh cũ trên web cũ (baogia.minhlongonline.com, cần đăng nhập) được chuyển sang đây
-- bằng nút "Chuyển ảnh từ web cũ" ở trang Sản phẩm (src/modules/integrations/api/legacy-images.ts). Chỉ Edge Function (service role) ghi.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
