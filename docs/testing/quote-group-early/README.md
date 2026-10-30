# Gom xin giao trước từ form sinh đơn/HĐKT

Trước đây mỗi mã có nút “Xin giao trước” và tạo một phiếu riêng. Nay bỏ nút riêng; khi sinh đơn/HĐKT, mọi nguồn incoming có SL > 0 được gom vào **một phiếu nháp** qua một lần POST `/purchase-early-requests`.

- Mỗi SKU chỉ có một dòng tổng; `sourceOrders` giữ số lượng theo đúng từng đơn mua đã chọn. Nếu cùng SKU/đơn mua có nhiều dòng phân bổ, cộng trước khi kiểm tra giới hạn nguồn.
- Dòng số lượng 0 không tạo yêu cầu. Không tự chuyển sang đơn mua khác.
- Mọi dòng được gắn cùng liên kết phiếu, được đưa vào ghi chú/kế hoạch nguồn của đơn bán. Phiếu chưa gửi NCC, chưa ghi nhận nhập kho.
- Bấm tiếp tục sinh đơn trên cùng form không tạo lại phiếu đã lưu. Nếu mất phản hồi, giữ nguyên payload và clientKey, khoá nguồn đang chờ; nút “Tiếp tục lưu phiếu xin giao trước” đối chiếu bằng cùng lần gửi. Không sinh phiếu riêng cho từng mã khi thử lại.
- Nếu bước sinh đơn bán sau đó lỗi/huỷ, phiếu nháp đã lưu vẫn được giữ như các yêu cầu nguồn khác. Form không tự tạo thêm phiếu chung thứ hai khi có nguồn mới sau lần lưu thành công; báo rõ để kiểm tra phiếu đã có.

Không migration, không sửa quyền hay chứng từ thật. Dùng cơ chế transaction/idempotency và phân bổ nguồn hiện có của API.

## Xác minh

- 26 ca `quote-sourcing-ui`, `order-create-ui`, `trial-ui`: qua; gồm nhiều SKU, nhiều đơn nguồn cho cùng SKU, dòng 0, vượt tổng nguồn và thử lại cùng key.
- `npm run typecheck`, `git diff --check`: qua.
- `scripts/testing/quote-group-early.mjs`: Chromium + router/PGlite với dữ liệu giả, 2021/1280/390px. Hai SKU từ hai NCC/đơn mua khác nhau tạo đúng một parent request, đúng allocations và cùng liên kết. Gọi prepare lần hai không tăng số phiếu. Giả lập mất phản hồi sau commit rồi thử lại: cùng key/payload, không tăng số phiếu.
- Không gọi CRM/Sapo/GHN thật.

[Kết quả](results.json) · [Màn hình lớn](quote-2021.png) · [Điện thoại](quote-390.png)
