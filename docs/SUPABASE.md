# Supabase và bản dùng thử v2

Project: `taceqfnsorewelsbdckg`. PostgreSQL thay D1; Supabase Storage thay R2.

- 62 bảng đã được tạo, bật RLS và chặn `anon`/`authenticated` truy cập trực tiếp. Các route backend dùng phân quyền staff hiện có.
- Bucket private: `baogiabachngan-v2-files`, tối đa 6 MB/file, JPEG/PNG/WebP/PDF. Chưa gắn màn hình upload trong bản dùng thử.
- `migrations/` là lịch sử SQLite cũ, giữ lại cho đối chiếu; `migrations/postgres/` là migration PostgreSQL. Chỉ thêm migration mới, không sửa file đã áp dụng.
- Các migration schema do Drizzle sinh; trigger, dữ liệu chức vụ và quyền platform được ghi trong SQL bổ sung. Apply lần lượt mọi `.sql` trong `migrations/postgres/`, kể cả file không nằm trong journal Drizzle.
- Runtime Cloudflare riêng dùng `DATABASE_URL` transaction pooler, `prepare:false`, SSL. Gọi `closeDb` sau mỗi request; không chia sẻ kết nối xuyên request trên Workers.
- Bản dùng thử gọi Supabase Edge Function `baogia-v2-api`, dùng `SUPABASE_DB_URL` có sẵn của Edge Functions. Function kiểm tra Origin, áp dụng xác thực staff cho mọi route riêng tư và chuyển phiên thành bearer token cho frontend.
- Frontend ở `trial-ui/`; website dùng thử chưa được xuất bản, chưa có link preview hoạt động và chưa cấp tài khoản dùng thử. Origin dự kiến là `https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site`; khi triển khai ở địa chỉ khác phải cập nhật Origin trong Edge Function. Liên kết kích hoạt được cấp riêng, không lưu token hay mật khẩu trong repo.
- Bản thử có: kích hoạt/đăng nhập, danh bạ khách hàng, tạo/sửa báo giá, tính VAT/chiết khấu/phí in, in hoặc lưu PDF, chặn cập nhật phiên bản cũ. Cổng NCC và kết nối Sapo chưa mở trong UI này.
- Chưa chuyển dữ liệu thật từ repo cũ, chưa nạp `SAPO_ADMIN_COOKIE`.

Kiểm tra: `npm run typecheck`, `npm test`. PostgreSQL được thử bằng PGlite; `tests/db/upgrade.test.ts` giữ kiểm tra lịch sử SQLite. Các test legacy yêu cầu checkout repo cũ qua `LEGACY_REPO`.
