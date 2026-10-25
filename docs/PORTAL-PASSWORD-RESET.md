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

Có thể đặt `CHROMIUM_PATH`; script giả lập toàn bộ API và chặn truy cập ngoài localhost. Không thêm Playwright vào dependencies production. Các test phát triển không gửi mail thật hoặc xác nhận inbox/Resend production.

## Lỗi rollout “Không tìm thấy” ngày 25/10/2026

PR308 đã merge tại f846f51…; UI deploy nhanh hơn API đang xếp hàng sau một lượt deploy cũ. Nút quên mật khẩu mới gọi POST /forgot-password vào API cũ, nhận404. Đây là thiếu endpoint ở bản triển khai, không phải phản hồi tài khoản không tồn tại (endpoint hiện hành luôn trả thông báo chung cho trường hợp đó).

Lượt API cũ40187220063 được hủy khi mới chạy test, chưa có bước ghi production; commit mới bao gồm commit cũ. Run40187235677 cho f846f51… sau đó thành công, có bước deploy Edge Function thành công. Probe email rỗng đã đổi từ404 sang400 kiểm tra email; không yêu cầu đổi mật khẩu hoặc gửi mail tài khoản thật. Source release gate/thông báo404 bên dưới vẫn cần PR/review trước khi triển khai.

Workflow UI bổ sung bước chờ source API gần nhất trên first-parent của main. Chỉ cho phát hành UI khi run tương ứng đúng SHA thành công **và bước Triển khai Edge Function thực sự thành công**. Workflow thành công do bỏ qua thiếu secret không được coi là API đã lên. Thất bại/hết thời gian chờ giữ UI cũ; bước chờ chỉ đọc Actions metadata, không tự deploy hoặc bỏ test. UI-only commit cũng chờ API nguồn mà nó phụ thuộc, không chỉ kiểm diff của commit UI cuối.

Nếu vẫn gặp endpoint404 trong lúc rollout hoặc cấu hình lệch, form thông báo chức năng đang cập nhật, giữ email và cho thử lại; không hiển thị404 như lỗi tra cứu tài khoản. Test browser giả lập404 → thử lại200 trên cả3 trang và kiểm chống gửi trùng. Không gửi mail thật để kiểm thử lỗi này.
