-- Sổ kho: chỉ API máy chủ truy cập; không công khai qua Data API.
REVOKE ALL ON TABLE public."stock_moves" FROM anon, authenticated;
REVOKE ALL ON TABLE public."stock_balances" FROM anon, authenticated;
