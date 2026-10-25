# Quên mật khẩu — NCC và khách hàng

Tại trang đăng nhập NCC, trang khách hàng hoặc form đăng nhập chung, bấm **Quên mật khẩu?**, nhập **email đã đăng ký** rồi gửi yêu cầu. Nếu tài khoản NCC/khách hàng đang hoạt động và có email thật, hệ thống gửi link **Đặt mật khẩu mới**. Link hiệu lực 60 phút, chỉ dùng một lần; yêu cầu link mới thay link cũ. Nhập mật khẩu mới 8–128 ký tự, nhập lại để xác nhận, rồi đăng nhập lại.

Tài khoản chỉ có số điện thoại/email `.invalid` cần được bổ sung email đăng ký trước. Tài khoản nội bộ tiếp tục dùng luồng cấp link của Manager. Không lấy email liên hệ của một NCC/khách khác để thay email tài khoản đăng nhập.

## Dùng lại cấu hình mail hiện có

Dùng đúng `c.env.mailer` và `sendMail` như `POST /purchase-orders/:id/send-email`: Resend `RESEND_API_KEY` và `MAIL_FROM` đã cấu hình. Không thêm nhà cung cấp hay secret mới. Mail reset chỉ có người nhận là email tài khoản; **không dùng MAIL_CC, không CC nhân viên/Manager, không chuyển tiếp nội dung đơn mua**. Không gửi mật khẩu qua email.

## API và dữ liệu

- `POST /api/staff/forgot-password { email, audience?: 'supplier'|'customer' }`, public nhưng vẫn kiểm Origin và rate limit: 3 lần/email và 10 lần/IP mỗi 15 phút. Trả cùng thông báo cho tài khoản hợp lệ, không có, bị khoá, nội bộ hoặc sai loại trang. Không trả token/link/email người nhận. Thiếu cấu hình mail trả 503 chung.
- Tận dụng `staff_credentials.activation_hash/activation_expires` và `/activation-info`, `/activate`. Không migration. Chỉ lưu SHA-256 của token 256 bit; link nằm trong fragment của `reset-password.html`, trang xoá fragment khỏi URL khi mở, không ghi token vào localStorage hay nhật ký.
- Lúc yêu cầu link, chỉ thay hash/hạn token: mật khẩu cũ và các phiên vẫn hoạt động. Khi đổi mật khẩu thành công, token bị dùng hết, version tăng và mọi phiên cũ bị thu hồi. Đổi mật khẩu bằng mật khẩu hiện tại cũng huỷ link đang chờ.
- Credential transaction khóa tài khoản trong khi phát hành/gửi link. Gửi mail lỗi rollback token và giữ link/mật khẩu trước đó; trả thông báo chung để không tiết lộ email có tài khoản. Log chỉ có nhãn `password_reset_mail_failed`, không token, địa chỉ mail hay phản hồi thô nhà cung cấp.
- Edge dùng `waitUntil` đã có để xử lý mail nền; môi trường không có `waitUntil` (test) chờ xử lý. Không nhận URL chuyển hướng từ client: link dùng origin đã qua kiểm tra của ứng dụng và đường dẫn cố định.

## Kiểm thử và giới hạn

`portal-forgot-password.test.ts`: cùng cấu hình sender, không CC, NCC/khách hàng, không tiết lộ account/token, không khoá mật khẩu khi yêu cầu link, thu hồi phiên sau đổi, hết hạn/thay link, hai lần redeem đồng thời chỉ một thành công, lỗi mail rollback, CSRF/rate limit/config và waitUntil.

Chạy thêm `auth-routes`, `customer-activation-ui`, `partner-registration` và `partner-registration-ui`. Browser mock kiểm actual customer.html/supplier.html/index.html tại 390px, click đúp không gửi trùng; trang reset xoá fragment, kiểm nhập lại và hoàn tất. Chạy bằng:

```sh
npm install --prefix /tmp/pos-browser playwright
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/portal-forgot-password.mjs
```

Có thể đặt `CHROMIUM_PATH`; script giả lập toàn bộ API và chặn truy cập ngoài localhost. Không thêm Playwright vào dependencies production. Phiên phát triển chưa gửi mail thật, chưa xác nhận inbox/Resend production và chưa deploy.
