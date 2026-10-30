# Cột giá và cảnh báo tồn trong báo giá

- Giãn cột SL, đơn giá, CK và giá sau CK; giảm cỡ chữ/giãn chữ ở tiêu đề. Bảng cuộn ngang trong khung trên desktop; điện thoại giữ bố cục thẻ.
- Dấu `!` màu cam cạnh mã hàng khi tổng số lượng của mã đó trong báo giá vượt tồn khả dụng. Tooltip có tổng SL, có thể bán và SL thiếu; không chặn lưu hoặc thay đổi giá/số lượng.
- Dùng cùng phép tính tồn khả dụng của màn hình kiểm tồn: tổng kho thật trừ phần đang giữ của báo giá/đơn khác, bỏ phần giữ của báo giá đang sửa. Không cộng tồn NCC/hàng đang về. Dòng phụ phí và dữ liệu tồn chưa xác định không cảnh báo.
- Tra sản phẩm theo lô tối đa 200 SKU, trễ gộp 120 ms, giữ kết quả 60 giây; dữ liệu giữ hàng dùng cache 30 giây hiện có. Sửa số lượng dùng cache, không tra từng dòng/từng phím. Yêu cầu lỗi không xem như tồn 0, có khoảng chờ trước thử lại. Phản hồi muộn chỉ cập nhật huy hiệu của các dòng hiện tại.
- Không sửa API, dữ liệu thật hoặc quy tắc chặn tồn lúc duyệt/sinh đơn; không cần migration.

Kiểm tra:

- `tests/app/quote-stock-warning.test.ts`: cộng SKU lặp, không tính phụ phí, tồn 0/âm/chưa biết, cache, phản hồi muộn và lỗi mạng.
- `scripts/testing/quote-stock-warning.mjs`: PGlite + router/giao diện thật trong Chromium cục bộ, HRC 1354px, B2B 1024px (CK hỗn hợp %/tiền), VIGIFTS 1354px và HRC 390px. Kiểm tra hình học tiêu đề, trang không cuộn ngang, badge, loại phần tự giữ và không thêm lượt tra tồn khi sửa SL. Chỉ dùng dữ liệu giả.

Ảnh sau chỉnh: [Desktop](desktop.png) · [Điện thoại](mobile.png). [Kết quả Chromium](results.json).
