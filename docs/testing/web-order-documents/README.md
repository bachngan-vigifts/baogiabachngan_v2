# Kiểm tra đơn web trong CRM

Dùng dữ liệu mẫu, API qua router thật và GHN giả lập; không tạo vận đơn production.

- 11 file test liên quan đã qua: CRUD web, tiền/CK/VAT, cầu nối Lock, GHN Minh Long, tài chính, xuất/hoàn kho, tổng đơn, theo dõi GHN, quyền quầy, lọc công nợ/giao hàng và migration.
- Chạy bổ sung bộ API trên PostgreSQL 17 riêng: 6 tình huống, gồm sửa hàng đồng thời với xác nhận/gửi lặp GHN. Chỉ một lần Create và bản hàng đã gửi không bị đổi.
- Playwright dùng giao diện đầy đủ cho Lock/Minh Long × 1280/390px: từ danh sách mở mã Web_, sửa số lượng/tổng, kiểm tra bản in. Chặn mọi request trình duyệt ra ngoài localhost.

Chạy browser: `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/web-order-documents.mjs` (cần Chromium `/usr/bin/chromium`). Kết quả và ảnh chụp lưu `/workspace/scratch/web-order-documents`.

Chưa xác minh API/site/GHN production sau thay đổi. Dữ liệu cũ thiếu phân rã giá/VAT phải đối chiếu nguồn; không tự điền bằng phỏng đoán.
