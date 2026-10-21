# Xin lấy trước nhiều mã — phương án schema chờ duyệt

Người dùng đã duyệt tạo migration 3 bảng ngày 21/10/2026; hai file 20261021063222_purchase_early_requests.sql và 20261021063421_supabase_access_purchase_early_requests.sql đã tạo bằng Supabase CLI, chưa áp dụng DB thật. Giữ nguyên 2 bảng xin hàng cũ để không đổi nghĩa dữ liệu cũ. Không gắn đơn khách, không ghi nhận đã nhận hàng, không thay công thức tồn/công nợ, không tạo cron/Sapo sync/quyền mới.

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

## Bổ sung phiếu nháp theo yêu cầu mới — ĐÃ DUYỆT TẠO MIGRATION

Người dùng yêu cầu sau lưu có phiếu nháp để chỉnh ngày lấy và đã duyệt bổ sung 5 cột ngày 21/10/2026. Migration 20261021064101_purchase_early_request_drafts.sql đã tạo bằng Supabase CLI; chưa áp dụng DB thật. Đây là phiếu xin lấy trước, không tạo thêm đơn mua NCC để tránh cộng trùng hàng đang về. Thêm đúng 5 cột vào header `purchase_early_requests` (không thêm bảng):

- `status text NOT NULL DEFAULT 'submitted' CHECK IN ('draft','submitted')`: dữ liệu gửi cũ vẫn là submitted; draft chưa hiện cho NCC, chỉ hiện nội bộ.
- `pickup_date text NOT NULL DEFAULT ''`: ngày lấy theo Việt Nam, bắt buộc ngày hợp lệ khi gửi; không sửa ngày hẹn gốc của đơn mua.
- `scope text NOT NULL DEFAULT '{}'`: JSON bộ lọc NCC/ngày khi lập phiếu để sửa/gửi không tự chuyển sang NCC khác.
- `updated_at text NOT NULL DEFAULT ''`: thời điểm chỉnh gần nhất; dữ liệu cũ fallback created_at.
- `revision bigint NOT NULL DEFAULT 1`: chống hai người ghi đè phiếu nháp.

Luồng: chọn nhiều SKU → mở phiếu nháp nhập ngày lấy và kiểm từng mã → Lưu nháp (chưa gửi) → sửa SL/ngày lấy → Gửi NCC (đọc lại số còn về, giữ chống bấm đúp). Chỉ Manager/Sale Admin sửa/gửi; submitted không sửa theo luồng này, NCC vẫn chỉ chấp nhận/từ chối phần của mình. Audit mỗi lần lưu/sửa/gửi. Không đổi tồn hay sinh đơn mua/nhận hàng/task. Lần duyệt tạo migration không bao gồm chạy DB thật.

Điểm phản hồi trên API thực tế là `POST /supplier-portal/early-requests/:id/respond`, trong đó id là request-line ID. Một phản hồi cập nhật nguyên tử tất cả phân bổ của cùng SKU thuộc NCC đang đăng nhập; không cập nhật phần của NCC khác. Nhờ vậy NCC phản hồi đúng một lần cho một mã, dù mã đó trải nhiều đơn mua.
