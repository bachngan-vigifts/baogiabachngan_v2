# In nhanh tem giá

Trang Sản phẩm: tick từng mã hoặc **Chọn tất cả sản phẩm trang này**, bấm **In tem giá**. Lựa chọn giữ khi đổi trang/lọc như luồng lập báo giá sẵn có; Bỏ chọn để làm lại.

Chọn mẫu LocknLock hoặc Minh Long; mặc định 70 × 35 mm và 70 × 50 mm. Đây là kích thước tạm theo ảnh tham chiếu; có ô chỉnh ngang/cao trước khi in. Lề mặc định 0 mm, xếp sát cạnh, tự chia nhiều trang A4. Lề 0 cần máy hỗ trợ in sát mép; có thể đổi sang 3 mm. Chọn tỷ lệ 100%, tắt header/footer trình duyệt. Bản in được giữ đến afterprint để Safari đọc được nội dung.

Giá lấy lại từ API lúc mở, chỉ chọn bảng có tên Giá bán lẻ (+ VAT) / Giá lẻ + VAT. Nếu có nhiều bảng cùng tên phải chọn rõ. Không dùng bảng đang chọn để báo giá, không cộng VAT lần hai, không fallback giá nhập. Thiếu giá thì chặn in và báo SKU. Giá 0 có sẵn được giữ. Tên/mã/giá quá dài không vừa tem thì báo tăng kích thước, không cắt mất nội dung.

Hai mẫu có QR nội bộ ZXing, không gọi dịch vụ QR bên ngoài. Mặc định QR chứa SKU giữ số 0 đầu để quét tìm hàng POS; tuỳ chọn link trang sản phẩm CRM cần đăng nhập. Thương hiệu dựng bằng chữ theo bố cục mẫu ảnh, không có file logo gốc. Có thể in nhiều bản mỗi sản phẩm (1–100; tối đa 1.000 tem). Không thay đổi dữ liệu giá, tồn, báo giá, đơn hàng.

## Kiểm tra

- `node --import tsx tests/app/price-labels.test.ts`: policy VAT, không tính thuế lần hai, thiếu giá/giá 0, SKU leading zero/link encode, A4/margins/capacity, tải mới theo batch và giữ thứ tự. Node 22 và 24 đều qua.
- `npm run typecheck`, `npm run ui:build` qua.
- `PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node --import tsx scripts/testing/price-labels-review.mjs`: router/PGlite thật, Chromium tại 360/390/430/768/1280 px, tick chọn/mở popup, hai mẫu, giá đúng 108.000 thay vì giá chưa VAT 100.000, QR giải mã thật, SKU/link/Unicode/leading zero, in lặp khi thiếu afterprint và dọn đúng sau afterprint. Không business API writes/JS errors.
- 25 tem Lock chia 24+1; Minh Long chia 15+10. Hai PDF có đúng 2 trang A4, `pdfinfo` 594.96 × 841.92 pt. Chưa thử trên máy in vật lý/iOS thật.

Ảnh/PDF và kết quả được lưu cục bộ tại `/workspace/scratch/price-labels/`, không đính kèm GitHub. Dữ liệu là fixture do script tạo, không lấy từ production.
