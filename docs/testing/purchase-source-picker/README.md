# Chọn đơn mua nguồn khi xin hàng trước

Phạm vi bổ sung vào PR sửa sản phẩm POS trước khi GHN lấy hàng:

- **Hàng đang về theo mã:** chọn một hoặc nhiều đơn mua bên cạnh từng SKU, nhập SL từng đơn, tự cộng tổng. Nếu đã nhập tổng rồi chọn một đơn, giữ SL đó trong giới hạn đơn được chọn. Tổng chuyển sang chỉ đọc khi đã chọn nguồn; bỏ hết nguồn sẽ bỏ chọn mã, không tự chuyển sang đơn khác.
- **Sinh đơn/HĐKT từ báo giá:** nguồn “Hàng đang chờ về · Xin giao trước” thêm ô chọn đơn, hiện số đơn, NCC, ngày hẹn và SL còn về. Bắt buộc chọn nguồn và chặn vượt SL của nguồn đó. Trên điện thoại có dòng chi tiết đủ số đơn/ngày hẹn dưới ô chọn. Một SKU chỉ tải danh sách nguồn khi cần và dùng lại kết quả trong cùng form.
- Chuyển `sourceOrders` qua luồng nháp hiện có. API hiện có khóa và đọc lại lượng còn về khi lưu/gửi; không tự lấy bù từ đơn khác. Chọn trên bảng chưa gửi NCC hay ghi nhập kho; người dùng tiếp tục lưu/gửi bằng các bước hiện có.
- **Tạo đơn trên Sapo:** mặc định “Có” trong form sinh đơn hàng; form HĐKT vốn đã mặc định “Có”. Vẫn cho chọn “Không”; mở form không gọi tạo đơn Sapo.
- **Vị trí các bảng chi tiết đơn:** đã nằm trên main từ PR #389. Kiểm tra lại Khách hàng | Đơn hàng/HĐKT ở hàng trên; Lịch giao hàng | Công nợ ở hàng dưới. Không lặp lại thay đổi đã merge.

Không migration, không thay quyền, không merge/triển khai và không sửa chứng từ thật.

## Kiểm tra

- 26 ca UI/markup: `quote-sourcing-ui`, `order-create-ui`, `purchase-incoming-ui`, `trial-ui` — qua.
- 10 ca domain/API: `purchase-early-requests`, `purchase-incoming`, `early-order-sources` — qua.
- `npm run typecheck`, `git diff --check` — qua.
- `scripts/testing/purchase-source-picker.mjs`: Chromium thật với router/PGlite, dữ liệu giả ở 2021px, 1280px và 390px. Chọn PO-a2 thay vì PO-a1, chặn vượt 7.000, lưu/gửi đúng PO-a2. Từ báo giá cũng gửi đúng PO-a2; kiểm tra ngày hẹn, hàng không tràn khung, mặc định Sapo và vị trí ba bảng.
- Không gọi CRM/Sapo/GHN thật. Chạy browser bằng `PLAYWRIGHT_MODULE=... node --import tsx scripts/testing/purchase-source-picker.mjs`.

[Kết quả](results.json) · [Hàng đang về](incoming-1280.png) · [Nguồn khi sinh đơn](quote-2021.png) · [Điện thoại](quote-390.png)
