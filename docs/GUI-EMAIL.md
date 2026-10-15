# Gửi email từ hệ thống (Resend)

Nút **"✉ Gửi email NCC"** trên trang đơn mua NCC có hai chế độ.

**Đã cấu hình:** máy chủ gửi thẳng email đơn đặt hàng cho NCC, đính kèm file PDF.
- Người nhận là email "Nhận đơn" và CC theo danh bạ NCC. Nếu Manager đã chốt người nhận lúc duyệt thì dùng người nhận đó.
- Email tự CC thêm **nhân viên phụ trách**: người lập đơn mua và người phụ trách các chứng từ nguồn (người lập báo giá, người phụ trách đơn hàng / HĐKT, người phụ trách yêu cầu hỏi tồn), cùng **mọi Manager**. Chỉ tính nhân viên còn hoạt động. Ngoài ra CC thêm các địa chỉ trong `MAIL_CC`.
- Khi NCC bấm trả lời, email về người đã bấm gửi.
- Mỗi lần gửi được ghi vào lịch sử đơn.

**Chưa cấu hình:** hệ thống tải PDF về máy và mở ứng dụng mail. Người dùng tự đính kèm file vừa tải rồi gửi.

Mã API chỉ nhập trên Supabase. Không gửi qua chat, không ghi vào code hay PR.

## Cài đặt (làm một lần)

**1. Tạo tài khoản và xác thực tên miền gửi trên https://resend.com**
- Gói miễn phí: khoảng 3.000 email/tháng, 100 email/ngày.
- Vào **Domains → Add Domain** và nhập tên miền của công ty, ví dụ `bachngan.vn`.
- Thêm các bản ghi DNS (SPF, DKIM) mà Resend hiển thị vào nơi quản lý tên miền. Chờ đến khi trạng thái là **Verified**.

**2. Tạo mã API**
- Vào **API Keys → Create API Key**.
- Quyền: *Sending access*, chọn đúng tên miền vừa xác thực.
- Sao chép mã (bắt đầu bằng `re_…`).

**3. Nhập secret vào Supabase**
- Vào **Project → Edge Functions → Secrets** (hoặc **Project Settings → Edge Functions**).
- Thêm 2 secret:

| Tên | Giá trị (ví dụ) |
|---|---|
| `RESEND_API_KEY` | `re_…` (mã vừa tạo) |
| `MAIL_FROM` | `Bách Ngân <don-hang@bachngan.vn>` |
| `MAIL_CC` (tuỳ chọn) | email luôn được CC mọi email đơn đặt hàng gửi NCC, nhiều địa chỉ cách nhau dấu phẩy |

- Địa chỉ trong `MAIL_FROM` phải dùng **đúng tên miền đã xác thực** ở bước 1.

**4. Kiểm tra**
- Secret có hiệu lực ngay, không cần triển khai lại.
- Mở một đơn mua đã duyệt, bấm "✉ Gửi email NCC", rồi xem lịch sử đơn có dòng "Đã gửi email đơn đặt hàng (kèm PDF) tới …".

## Khi gặp lỗi

| Thông báo | Nguyên nhân / cách xử lý |
|---|---|
| "Máy chủ chưa bật gửi email" | Chưa có `RESEND_API_KEY` hoặc `MAIL_FROM`. Hệ thống tự quay về cách mở ứng dụng mail. |
| "Dịch vụ email từ chối gửi (kiểm tra RESEND_API_KEY / tên miền…)" | Mã API sai hoặc đã bị thu hồi, hoặc `MAIL_FROM` không thuộc tên miền đã xác thực. |
| "… gửi quá nhiều, thử lại sau ít phút" | Vượt giới hạn của gói Resend. |

**Muốn ngừng gửi từ máy chủ:** xoá secret `RESEND_API_KEY`. Nút gửi email sẽ quay về cách mở ứng dụng mail.

## Kỹ thuật

- **Code:**
  - `src/core/mail/send-mail.ts`: gọi `POST https://api.resend.com/emails`, timeout 20 giây. Thông báo lỗi trả cho người dùng không chứa mã API hay phản hồi thô của Resend.
  - Route: `POST /purchase-orders/:id/send-email { pdf }` trong `src/modules/suppliers/api/purchase-routes.ts`.
- **Quyền:** Manager hoặc Kế toán, với đơn đã duyệt và chưa huỷ.
- **Nội dung do máy chủ quyết:** người nhận, tiêu đề, nội dung email do máy chủ tạo theo đơn, không nhận từ trình duyệt.
- **File PDF:**
  - do trình duyệt tạo (`trial-ui/purchase-pdf.js`), cùng file với nút "PDF gửi NCC";
  - máy chủ kiểm tra file phải bắt đầu bằng `%PDF-` và nặng không quá khoảng 4 MB.
- **Test:** `tests/app/purchasing.test.ts`, dùng Resend giả.
