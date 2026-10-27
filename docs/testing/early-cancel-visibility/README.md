# Nút huỷ/xoá dễ nhận biết

Ảnh người dùng cho thấy “Huỷ phiếu và xoá” đã có trên chi tiết, nhưng trông như chữ thường. Nguyên nhân: nút dùng `btn danger small`, trong khi stylesheet không định nghĩa `.btn.danger` nên nền và viền đều trong suốt.

Dùng variant sẵn có `btn primary danger-bg` (nền đỏ, chữ trắng) trên danh sách và chi tiết. Nút xác nhận huỷ/xoá trong hộp thoại cũng dùng variant đỏ. Không thay quyền, API, trạng thái, điều kiện xoá, dữ liệu hay tồn kho.

Validation:

- Typecheck, build UI và diff check đạt.
- Browser scripts `early-list-actions.mjs` và `early-cancel-delete.mjs` chạy với router/PGlite cục bộ: danh sách và chi tiết ở 390/1280px; kiểm tra màu nền đỏ bằng computed style; hộp xác nhận trước khi ghi; Manager huỷ phiếu nhiều NCC đã đồng ý; phiếu có nhận hàng bị chặn; tài khoản kho không có nút; stock_moves không đổi; không lỗi JavaScript.
- Ảnh đính kèm lấy từ dữ liệu thử cục bộ. Không xoá phiếu thật. Bộ test đầy đủ chạy tiếp trên CI.
