# Xin hàng trước bằng ảnh: đọc phiếu bằng AI

Nút **Đọc ảnh** trong "Xin hàng trước bằng ảnh" gửi ảnh phiếu lên máy chủ CRM; máy chủ gọi model Claude Opus 5.5 (Anthropic) để chép mã hàng, số lượng, số PXK và số đơn. Kết quả chỉ là đề xuất: nhân viên vẫn phải so với ảnh gốc và đánh dấu xác nhận trước khi sang bước đối chiếu đơn mua.

## Bật tính năng

1. Tạo API key tại console.anthropic.com (tài khoản trả phí theo lượng dùng, tách với gói Claude đang dùng để chat).
2. Supabase → Edge Functions → Secrets → thêm `ANTHROPIC_API_KEY`.
3. Không cần deploy lại. Chưa có khoá thì giao diện tự dùng bộ đọc trên máy như trước.

Gỡ secret là tắt tính năng; không cần đổi code.

## Máy chủ kiểm gì

- Quyền `purchases.early-request` (hoặc Manager), kiểm tại máy chủ.
- Ảnh JPG / PNG / WebP, tối đa 5 MB, đúng chữ ký đầu file.
- Tối đa 150 lượt đọc mỗi người trong 24 giờ.
- Kết quả của model phải đúng lược đồ; mã sai dạng hoặc số lượng không phải số nguyên dương thì để trống và đánh dấu ⚠.
- Tổng số lượng các dòng được so với tổng in trên phiếu (ví dụ "Tổng SL giao"): khớp, lệch, hoặc phiếu không in tổng.
- Mã hàng được tra trong danh mục CRM; mã chưa có thì đánh dấu ⚠.

## Dữ liệu

- Ảnh được gửi tới Anthropic để đọc và không lưu trong CRM.
- Nhật ký (`audit_logs`, action `early-photo-read`) chỉ ghi người đọc, số dòng, kết quả đối chiếu tổng, dung lượng ảnh và số token; không ghi ảnh hay nội dung phiếu.
- Trình duyệt không chọn được model, lời nhắc hay khoá.

## Khi AI không dùng được

- Chưa cấu hình, quá tải, mất mạng, quá giờ: tự chuyển sang bộ đọc trên máy và báo rõ.
- AI từ chối ảnh hoặc vượt giới hạn lượt: báo lỗi, hiện nút **Đọc bằng bộ đọc trên máy**.

## Kiểm thử

- `tests/app/early-photo-read.test.ts`: quyền, kiểm ảnh, đối chiếu tổng, nhật ký, giới hạn lượt.
- `tests/app/early-photo-ai-client.test.ts`: nội dung gửi tới API và xử lý lỗi, chạy với máy chủ giả.
- `scripts/testing/early-photo-ai.mjs`: kịch bản trình duyệt ở 1440 px và 390 px với bộ đọc giả.

Các bài test không gọi dịch vụ thật và không dùng dữ liệu production.
