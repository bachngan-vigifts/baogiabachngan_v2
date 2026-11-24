# Kết nối phiên Sapo bằng Chrome

Manager mở Nhân viên → Kết nối lại → Mở Sapo để đăng nhập, đăng nhập/OTP/Turnstile trên trang Sapo thật rồi quay lại bấm Kết nối phiên vào CRM. Không nhập mật khẩu Sapo vào CRM. Chỉ dùng Chrome/Edge trên máy tính; không có cam kết hoạt động trong Chrome điện thoại.

## Cài một lần

Trong hộp kết nối, mở “Cài tiện ích Chrome”, tải `sapo-connector.zip` và giải nén vào thư mục cố định. Mở `chrome://extensions` (Edge: `edge://extensions`), bật chế độ dành cho nhà phát triển, tải thư mục đã giải nén có manifest.json, rồi tải lại CRM. Tiện ích chưa phát hành Chrome Web Store; không có cơ chế tự cập nhật. Khi có bản mới, thay thư mục, Reload tiện ích rồi tải lại CRM.

Mã nguồn nằm trong trial-ui/sapo-connector/. Tạo lại ZIP bằng `node scripts/package-sapo-connector.mjs`. Test kiểm ZIP khớp đúng ba file mã nguồn, không chứa tài khoản/khoá/secrets.

## Quyền và dữ liệu

- Manifest V3, chỉ quyền cookies cho bachngankiengiang.mysapogo.com; content script chỉ trên https://crm.minhlongonline.com. Không quyền đọc mật khẩu, không all_urls, không tự chạy lịch và không sửa cookie Sapo.
- Chỉ nhận bấm thật trong hộp kết nối đang mở, trên trang #/staff, top frame. Service worker kiểm lại sender thuộc chính tiện ích, origin/path/hash/frame và lấy đúng cookie store chứa tab CRM. Không chọn URL/shop tuỳ ý.
- Chỉ chuyển ba cookie đã có trong luồng Sapo hiện tại: sapo-admin, _admin_session_id, .AspNetCore.Session; bỏ cookie theo dõi, hết hạn, phân vùng, miền khác; từ chối giá trị không hợp lệ/trùng tên khác giá trị.
- Phiên đi qua bộ nhớ extension/content script và tin nhắn cùng origin CRM một lần; không đưa vào URL, DOM, log hoặc local/session/chrome.storage. Cookie không được lưu thành file. Trang CRM là bên nhận được uỷ quyền; đây không phải cách cách ly cookie khỏi mã JS khác đã chạy trên chính origin CRM.
- Mỗi lần kết nối có nonce, hạn chờ15 giây; callback sai nonce, đã đóng form, đổi tài khoản hoặc không còn Manager bị bỏ qua. Không tự retry việc lưu phiên.
- POST /admin/sapo-session hiện có vẫn là nguồn quyết định quyền Manager. Máy chủ gọi thử Sapo rồi mới mã hoá AES-GCM bằng khoá dẫn xuất từ SAPO_SYNC_TOKEN và lưu. Không thay cơ chế đồng bộ, hạn phiên, quyền dữ liệu hoặc RLS. Phiên bị Sapo từ chối không thay bản đang lưu.
- SSO Sapo đã quan sát ngày24/11/2026 qua trang công khai: chuyển accounts.sapo.vn, tải Turnstile; trả X-Frame-Options:DENY và frame-ancestors 'none'. Không nhúng iframe, không giả form mật khẩu hoặc né OTP/Turnstile.

## Xác minh và giới hạn

Kiểm thử tự động dùng browser profile tạm, cookie HttpOnly giả và API/PGlite cục bộ; chặn mạng ngoài. Mặc định scripts/testing/sapo-browser-connect.mjs chạy mã content/worker thật với API extension mô phỏng. Native mode SAPO_EXTENSION_NATIVE=1 nạp tiện ích thật bằng CDP và phải đạt nếu dùng để xác minh bản native; không skip lỗi. Chromium155 trong môi trường hiện tại báo “Loading of unpacked extensions is disabled by the administrator”, nên CHƯA xác minh cài/nạp tiện ích thật; không sửa hoặc vượt chính sách quản trị. Chưa đăng nhập tài khoản Sapo thật hoặc kiểm tra session thật trong production. Cần Manager cài tiện ích, đăng nhập Sapo thật và bấm kết nối sau deploy để xác minh đầu-cuối. Phiên có thể hết hạn/đăng xuất/bị Sapo thu hồi; tiện ích không bảo đảm cookie tồn tại vĩnh viễn. Shop/URL cấu hình khác cần bản được review riêng; không nhận base URL do trang gửi.

Không cần migration/API deploy: chỉ thay UI và thêm tiện ích. Triển khai UI sau CI/review và kiểm tra các gate hiện có của main; không bỏ gate. Rollback UI về bản trước và gỡ tiện ích trong trình quản lý extension. Phiên mã hoá đã lưu vẫn dùng được với API cũ; muốn thu hồi thì Manager dùng Ngắt kết nối trong CRM và đăng xuất Sapo nếu cần. Không tự xoá dữ liệu production.
