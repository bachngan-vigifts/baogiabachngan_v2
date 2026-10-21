# Xin lấy trước nhiều mã — phương án schema chờ duyệt

Chưa tạo migration hoặc đổi schema. Phương án dùng 3 bảng mới; giữ nguyên 2 bảng xin hàng cũ để không đổi nghĩa dữ liệu cũ. Không gắn đơn khách, không ghi nhận đã nhận hàng, không thay công thức tồn/công nợ, không tạo cron/Sapo sync/quyền mới.

## 1. purchase_early_requests — một lần Lưu và gửi NCC

- `id text PRIMARY KEY` (UUID).
- `client_key text NOT NULL`, `created_by text NOT NULL REFERENCES staff_members(id)`, `created_at text NOT NULL`.
- `payload_hash text NOT NULL`: đối chiếu cùng key nhưng khác nội dung; cùng key/cùng nội dung trả yêu cầu đã có, khác nội dung trả 409.
- UNIQUE `(created_by, client_key)`; index `created_at`.
- Không có liên kết đơn khách và không có cờ cho phép tự duyệt.

## 2. purchase_early_request_lines — một dòng mỗi SKU

- `id text PRIMARY KEY` (UUID), `request_id text NOT NULL REFERENCES purchase_early_requests(id)`.
- `line_no bigint NOT NULL`, `sku text NOT NULL`, `name text NOT NULL`, `unit text NOT NULL` (ảnh chụp lúc gửi).
- `quantity bigint NOT NULL CHECK (quantity > 0)`.
- UNIQUE `(request_id, sku)`, UNIQUE `(request_id, line_no)`.
- SKU không FK products: phải giữ được mã Excel ngoài catalog. Không trộn ĐVT khác nhau; báo cần chuẩn hóa dữ liệu trước khi gửi.

## 3. purchase_early_request_allocations — lượng xin từng NCC/đơn

- `id text PRIMARY KEY` (UUID), `request_line_id text NOT NULL REFERENCES purchase_early_request_lines(id)`.
- `purchase_line_id text NOT NULL REFERENCES incoming_shipment_lines(id)`, `supplier_id text NOT NULL REFERENCES suppliers(id)`.
- `quantity bigint NOT NULL CHECK (quantity > 0)`; tổng allocations phải bằng quantity dòng, kiểm trong transaction.
- `status text NOT NULL DEFAULT 'pending' CHECK IN ('pending','accepted','rejected')`.
- `responded_by text REFERENCES staff_members(id)`, `responded_at text`, `response_note text NOT NULL DEFAULT ''`.
- UNIQUE `(request_line_id, purchase_line_id)`; index `(supplier_id,status)`, index `purchase_line_id`.
- Chỉ NCC của allocation phản hồi; lấy supplier_id từ đơn mua, không tin supplier_id do trình duyệt gửi. Một SKU trải nhiều NCC thì từng NCC chỉ xem/phản hồi phần của mình; trạng thái dòng được tổng hợp, không lộ NCC khác.

## Transaction, audit và quyền

Manager và employee có positionId sale-admin được gửi; quyền xem trang mua giữ nguyên. Không trao quyền duyệt thay NCC cho Sale Admin hay Manager trong action này. NCC chỉ chấp nhận/từ chối phần được phân bổ cho NCC mình.

Gửi: khóa advisory theo SKU theo thứ tự ổn định, đọc lại đơn đủ điều kiện/phiếu nhận trước khi phân bổ, kiểm số nguyên dương và không vượt còn về, ghi header + lines + allocations trong một transaction. Audit dùng audit_logs hiện có: người gửi/thời điểm/toàn bộ dòng; phản hồi NCC ghi audit riêng. Không thêm cột audit khác.

RLS bật cả 3 bảng. Giữ mô hình API server đang xác thực session; không cấp quyền trực tiếp anon/authenticated và không thêm policy đọc công khai. Liệt kê thay đổi trong migration schema và migration access tương ứng trước khi thực thi. Duyệt tạo migration không bao gồm chạy DB live.

## Quy tắc đề xuất trong phương án

- Đề xuất phân bổ ngày hẹn từng dòng sớm nhất trước, fallback ngày đơn; không có ngày sau cùng, hòa ngày theo số đơn/ID. Không ràng buộc với đơn khách.
- Yêu cầu xin trước không giữ/trừ tồn và không là phiếu nhận. Mỗi lần gửi kiểm tổng xin không vượt lượng còn về thực tế tại thời điểm gửi, đúng prompt. Cùng idempotency key không sinh yêu cầu thứ hai. Yêu cầu khác key là yêu cầu độc lập; không tự phát minh cơ chế đặt giữ hàng hay giải phóng tồn. Hiển thị yêu cầu đã gửi để người dùng nhận biết.
- Các mặc định đã có trong prompt: không vượt còn về, Sale Admin không duyệt thay NCC, giữ nguyên quyền xem trang.

## API dự kiến sau khi duyệt

`POST /purchase-early-requests` nhận clientKey + danh sách sku/quantity; `GET /purchase-early-requests` cho nội bộ được phép; `GET /supplier-portal/early-requests` chỉ NCC mình; `POST /supplier-portal/early-requests/:allocationId/respond` nhận accepted/rejected + ghi chú. Mọi API có kiểm quyền server, audit và transaction; GET không sinh task, POST xin trước không gọi automation nhận hàng/trả tiền. Đây là các endpoint mới, chưa phải link/cổng hiện đang chạy.
