# Góp ý phần mềm

Trang `#/feedback` (menu **Góp ý phần mềm**) và nút **Góp ý / báo lỗi phần mềm** trong menu tài khoản (mở ở mọi trang). Mô-đun `src/modules/feedback` – chỉ phụ thuộc `staff`, `notifications`.

## Ai làm gì
- **Mọi nhân viên** (khu vực `business`; NCC / khách cổng thông tin không vào được): gửi góp ý, xem góp ý công khai, +1 (mỗi người một lượt, góp ý đã đóng không nhận +1), xem góp ý của mình kể cả riêng tư.
- **Người gửi ↔ người xử lý** trao đổi trong góp ý; người khác chỉ +1 (tránh loãng).
- **Người xử lý** = Manager hoặc chức vụ được cấp quyền **Quản lý góp ý phần mềm** (`feedback.manage`, trang Phân quyền): xem mọi góp ý kể cả riêng tư, đổi trạng thái (Mới → Đang xem xét → Đã lên kế hoạch → Đang làm → Đã xong / Không làm / Trùng góp ý khác), ưu tiên, gộp trùng theo mã `GY-xxxx`, **Sao chép cho lập trình** (Markdown gửi Claude / Codex: tiêu đề, trang, máy, mô tả, các bước, link ảnh 1 giờ, trao đổi).

## Gửi góp ý
- Loại (Báo lỗi / Đề xuất tính năng mới / Cải thiện giao diện / Khác), mức ảnh hưởng (Thấp / Vừa / Cao / Chặn công việc), tiêu đề ≥ 5 ký tự, mô tả ≥ 10 ký tự, các bước (báo lỗi), tối đa 3 ảnh (nén trên trình duyệt, kho file private), tuỳ chọn **Chỉ người xử lý xem**.
- Tự ghi trang đang dùng (chỉ nhận đường dẫn trong ứng dụng `#/…`) và thông tin máy (trình duyệt, loại máy, kích thước màn hình, phiên bản).
- `clientKey`: gửi lặp cùng nội dung → trả lại góp ý cũ; cùng mã khác nội dung → 409. Mỗi người tối đa 10 góp ý / giờ (429).
- Mã `GY-0001` cấp tuần tự trong giao dịch có khoá.

## Thông báo
- Góp ý mới → Manager + người có quyền Quản lý góp ý (mức Chặn công việc ghi rõ ở tiêu đề).
- Đổi trạng thái / ghi chú xử lý → người gửi. Trao đổi: người gửi viết → người xử lý; người xử lý viết → người gửi.

## Dữ liệu
Migration `20261105060000_software_feedback.sql` (chạy tay, cổng `scripts/sql/assert-software-feedback.sql` trong Triển khai API): `software_feedback`, `software_feedback_photos`, `software_feedback_votes`, `software_feedback_comments`; RLS bật, không cấp anon / authenticated. Lịch sử đổi trạng thái lưu ở `software_feedback_comments` (kind = `status`).

Test: `tests/app/software-feedback.test.ts`.
