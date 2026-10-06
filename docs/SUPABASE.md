# Supabase và bản dùng thử v2

Project: `taceqfnsorewelsbdckg`. PostgreSQL thay D1; Supabase Storage thay R2.

- 62 bảng đã được tạo, bật RLS và chặn `anon`/`authenticated` truy cập trực tiếp. Các route backend dùng phân quyền staff hiện có.
- Bucket private: `baogiabachngan-v2-files`, tối đa 6 MB/file, JPEG/PNG/WebP/PDF. Chưa gắn màn hình upload trong bản dùng thử.
- `migrations/` là lịch sử SQLite cũ, giữ lại cho đối chiếu; `migrations/postgres/` là migration PostgreSQL. Chỉ thêm migration mới, không sửa file đã áp dụng.
- Các migration schema do Drizzle sinh; trigger, dữ liệu chức vụ và quyền platform được ghi trong SQL bổ sung. Apply lần lượt mọi `.sql` trong `migrations/postgres/`, kể cả file không nằm trong journal Drizzle.
- Runtime Cloudflare riêng dùng `DATABASE_URL` transaction pooler, `prepare:false`, SSL. Gọi `closeDb` sau mỗi request; không chia sẻ kết nối xuyên request trên Workers.
- Bản dùng thử gọi Supabase Edge Function `baogia-v2-api`, dùng `SUPABASE_DB_URL` có sẵn của Edge Functions. Function kiểm tra Origin, áp dụng xác thực staff cho mọi route riêng tư và chuyển phiên thành bearer token cho frontend.
- Frontend ở `trial-ui/`; website dùng thử đã xuất bản riêng tư tại https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site . Manager được cấp liên kết đặt mật khẩu riêng. Khi triển khai ở địa chỉ khác phải cập nhật Origin trong Edge Function. Không lưu token hay mật khẩu trong repo.
- Bản thử có: kích hoạt/đăng nhập, đổi mật khẩu; danh sách báo giá (tìm không dấu, lọc loại/người tạo, sắp xếp, thống kê tháng); soạn báo giá toàn trang (chọn khách từ danh bạ, lưu khách mới vào danh bạ, chiết khấu %/₫ theo dòng, phí in, VAT riêng từng dòng, giá vốn & lợi nhuận, dán nhiều dòng từ Excel, đổi thứ tự/nhân đôi dòng, mẫu ghi chú, số tiền bằng chữ, Ctrl+S, cảnh báo rời trang khi chưa lưu, báo xung đột 409 và tải lại); nhân bản báo giá; in/PDF khổ A4; danh bạ khách hàng; trang Nhân viên cho Manager (tạo, sửa, khoá/mở khoá, cấp lại liên kết). Dùng tốt trên điện thoại (thanh điều hướng dưới, bảng thành thẻ). Cổng NCC chưa mở trong UI này; Sapo nằm ngoài phạm vi bản dùng thử theo yêu cầu chủ dự án.
- Tiền trên giao diện tính bằng `trial-ui/quote-math.js`, **sinh tự động** từ `src/modules/quotes/domain/quote-math.ts` (`npm run ui:build`; test báo lỗi nếu file cũ) – không viết lại công thức ở frontend.
- Chạy thử trên máy không cần Supabase: `npm run ui:dev` → http://localhost:8787 (PGlite trong bộ nhớ, `mgr@x.vn` / `mat-khau-12345`).
- Khi triển khai bản mới: tải lại toàn bộ `trial-ui/` (gồm `quote-math.js`) và deploy lại Edge Function (`DELETE` đã được thêm vào CORS cho thao tác khoá nhân viên; danh sách báo giá trả thêm `quoteDate`, `contact`, `phone`, `lineCount`, `mine`).
- Đã nạp 2.099 khách hàng riêng biệt và 20 chiết khấu theo thương hiệu từ web cũ. Danh mục sản phẩm R2 cần nhập qua file JSON; chưa có quyền đọc kho file từ phiên này. Sapo nằm ngoài phạm vi bản dùng thử theo yêu cầu chủ dự án.

Claude Code: xem [CLAUDE-SUPABASE.md](CLAUDE-SUPABASE.md) và cấu hình `.mcp.json` ở gốc repo.

Kiểm tra: `npm run typecheck`, `npm test`. PostgreSQL được thử bằng PGlite; `tests/db/upgrade.test.ts` giữ kiểm tra lịch sử SQLite. Các test legacy yêu cầu checkout repo cũ qua `LEGACY_REPO`.

Sản phẩm: `GET /products?q=&brand=&limit=&offset=`, `GET /product-brands`, `GET /products/:sku`. Manager nhập danh mục bằng nút **Nhập danh mục** trên trang Sản phẩm (gọi `POST /admin/catalog-import`). Nhập lại **cập nhật** tên/giá/tồn theo file, không tạo dòng trùng; giao diện gửi theo lô 500 sản phẩm và lô cuối mang `replaceAll` + danh sách mã của cả file để ẩn sản phẩm không còn trong file. Lô nào lỗi thì chọn lại file chạy lại (an toàn vì idempotent). Chi tiết: `docs/NHAP-DU-LIEU.md`.
