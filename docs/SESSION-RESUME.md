# Mở lại CRM bằng phiên đã lưu

Giao diện nhân viên mở ngay bằng hồ sơ của cùng phiên đã xác minh trước đó trong `localStorage`, đồng thời gọi `/me` ở nền để cập nhật thông tin/quyền. Không còn màn hình chờ “kiểm tra phiên đăng nhập” mỗi lần mở app. Sau khi cập nhật source, lần đầu chưa có hồ sơ lưu vẫn cần xác minh một lần; các lần mở sau dùng luồng mới.

- `trial-ui/session-resume.js`: hồ sơ chỉ dùng để dựng giao diện, gắn với đúng token hiện tại; không lưu mật khẩu hay dữ liệu đơn hàng. Cache hỏng, khác phiên hoặc không dùng được storage thì xác minh như trước. Tài khoản NCC/khách vẫn đi qua luồng chuyển cổng hiện có sau xác minh.
- `trial-ui/app.js`: dựng giao diện từ cache sau khi module khởi tạo xong, cập nhật menu/quyền khi `/me` trả về; tải lại trang hiện tại khi quyền thay đổi. Đăng nhập mới vẫn dùng thông tin đã xác minh. Đăng xuất, đổi mật khẩu, phản hồi 401 xóa cả phiên và hồ sơ; kết quả cũ không được tác động tài khoản mới.
- Lỗi mạng/5xx giữ giao diện đã mở và token để thử lại các thao tác. API tiếp tục xác thực phiên và kiểm quyền trên mọi yêu cầu; không thay đổi thời hạn phiên hoặc quyền server, không thêm chế độ đọc/ghi nghiệp vụ offline.

Kiểm thử: `session-resume`, `login-focus`, `app-startup`, `trial-ui` và typecheck. Browser mock chạy module graph thật ở 390px/1280px, giữ `/me` chưa phản hồi để xác nhận mở ngay, rồi kiểm 503 giữ app và 401 xóa phiên/cache:

```sh
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/session-resume.mjs
```

Script chặn kết nối ngoài localhost và dùng API giả, không đăng nhập tài khoản thật. Chưa kiểm Safari/iOS thật; chưa triển khai production.
