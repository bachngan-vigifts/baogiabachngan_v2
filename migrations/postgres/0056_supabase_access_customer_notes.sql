-- Ghi chú nội bộ: chỉ API máy chủ truy cập; không công khai qua Data API.
REVOKE ALL ON TABLE public."customer_notes" FROM PUBLIC, anon, authenticated;
