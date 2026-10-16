-- Ảnh nghiệp vụ kho: chỉ API máy chủ truy cập; không công khai qua Data API.
REVOKE ALL ON TABLE public."warehouse_photos" FROM anon, authenticated;
