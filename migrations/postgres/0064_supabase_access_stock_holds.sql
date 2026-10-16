-- Giữ hàng cho báo giá: chỉ API máy chủ truy cập; không công khai qua Data API.
REVOKE ALL ON TABLE public."stock_holds" FROM anon, authenticated;
