# Cổng NCC: kết nối dữ liệu CRM

Ngày 12/11/2026. Thay bản mẫu trong luồng đăng nhập mặc định bằng `trial-ui/supplier-workspace.js`; bản thiết kế ngoại tuyến vẫn giữ riêng ở `design/`, không được import vào trang thật.

## Các trang đã nối

| Trang | Nguồn và hành vi |
|---|---|
| Tổng quan | Đơn mua đã duyệt của NCC, phiếu xin hàng đã gửi, công nợ và quá hạn hiện tại; đơn gần đây có giới hạn |
| Sản phẩm | Chỉ các SKU thuộc đơn mua đã duyệt/còn hiệu lực của NCC. Tên/ảnh/quy cách từ danh mục nếu có, giá giao dịch từ dòng đơn gần nhất sau CK/phí in; không trả giá vốn hoặc lợi nhuận bán hàng của công ty |
| Kiểm tồn | `supplier_published_stock`: NCC công bố theo mã/kho riêng, revision chống ghi đè. Chưa công bố là null, không lấy tồn kho công ty hay tồn NCC tổng hợp chưa có mapping để đoán |
| Đơn đặt hàng | `incoming_shipments`/`incoming_shipment_lines` đã duyệt và đúng supplierId; tách số CRM/số NCC. Chi tiết có tiền/VAT theo dòng, chứng từ chi và phiếu nhận. Bản ký dùng Storage private, xác nhận dùng workflow hiện có |
| Phiếu xin hàng | Phân bổ đã gửi của đúng NCC; phản hồi bằng API hiện có. Số công ty đã nhận lấy lại từ `earlyReceiptAvailability` có lọc supplierId, không suy toàn bộ nhận trên đơn là nhận theo phiếu |
| Điều chuyển | Chỉ phiếu được Manager chia sẻ tường minh qua `supplier_transfer_shares`. SKU phải thuộc đơn đã chia sẻ, phiếu phải đã duyệt. NCC chỉ xác nhận đã xem; không đổi trạng thái kho. Manager thu hồi được quyền chia sẻ |
| Tạm ứng | Đề nghị cọc theo tỷ lệ/điều khoản trên đơn. Ghi `deposit_requested_*` và audit; không tạo `supplier_payments` hoặc phiếu chi. Tiền đã nhận dựa trên khoản chi còn hiệu lực |
| Công nợ | Tổng tiền theo công thức hiện hành; phân bổ thanh toán vào lịch đến hạn sớm nhất, bỏ khoản đã hủy. Số dư hiện tại; không giả phục dựng số dư quá khứ từ trạng thái hiện tại. Đơn thiếu giá hiển thị riêng |
| Hóa đơn | `supplier_portal_invoices`: NCC nhập số/ký hiệu/ngày/tiền hàng/VAT, gắn đơn cụ thể; Manager đối chiếu. Không lấy hóa đơn đầu ra của khách hàng để giả làm hóa đơn NCC, không tự tăng công nợ |
| Phiếu giao hàng | NCC báo giấy giao ở `supplier_portal_deliveries`/`supplier_portal_delivery_lines`; phiếu nhận công ty lấy từ `supplier_receipts`/lines. Phân biệt hai nguồn và thống kê nhận đạt riêng, không cộng hai lần |

Không có hóa đơn/tồn công bố/phiếu chia sẻ cũ có cấu trúc thì trang trả rỗng hoặc “chưa có số liệu”. Migration không tự tạo chứng từ giả hoặc backfill dựa theo tên/SKU trùng. Hóa đơn khai báo hiện gắn một đơn mua; không phân bổ tự động một hóa đơn qua nhiều đơn.

## API và quyền

- `/supplier-portal/workspace`: hồ sơ NCC và khả năng thao tác; Manager chọn NCC để đối chiếu.
- `/supplier-portal/workspace/:page`, `/:page/:id`, `/:page/export`: cùng phạm vi SQL, bộ lọc và danh sách trường cho phép; không trả raw purchase view/note nội bộ/nguồn khách/số lương/file key.
- NCC lấy supplierId qua `supplier_accounts` và NCC đang hoạt động. Giả supplierId của người khác nhận 404. Staff thông thường không vào area này. Manager có position supplier vẫn bị giới hạn theo supplier, không thành admin.
- Manager không xác nhận/đề nghị cọc thay NCC trong cổng này. API `/supplier-workspace-admin/*` chỉ Manager thật được đối chiếu hóa đơn/chia sẻ/thu hồi điều chuyển; không mở cho Kế toán/Sale/NCC tự động.
- Upload bản ký kiểm tra nội dung file, loại ảnh/PDF và 6 MB, upload trước khi giữ khóa DB, cleanup file mới nếu giao dịch thất bại. Link bản ký chỉ cấp sau kiểm tra chủ đơn, hạn 300 giây.
- Invoice/delivery dùng clientKey + hash nội dung + unique key/number; khác nội dung không được giả là replay. Đơn và tồn dùng revision/khóa dòng; không tự retry POST khi mất mạng.
- Tất cả bảng mới bật RLS và thu hồi quyền PUBLIC/anon/authenticated, không có policy mở trực tiếp Data API. Chỉ router Edge hiện hữu truy cập sau kiểm tra phiên và quyền.

## Hiệu năng và số liệu

- Tải riêng trang đang mở; phân trang server 16/32/50, tối đa API 100 dòng. Không tải ba năm dữ liệu xuống browser sau login.
- Tính số tổng trên cùng bộ lọc với danh sách. Gom line/receipt/payment/schedule theo nhóm trong SQL, không gọi subquery tồn kho cho từng dòng UI. Dùng index supplier/order/line hiện có; không đổi pooler, compute hoặc index bảng nghiệp vụ cũ.
- Tìm kiếm debounce, hủy GET cũ và bỏ response lỗi thời. Export là thao tác riêng, tối đa 10.000 dòng; vượt phải lọc hẹp, không âm thầm cắt dữ liệu.
- Có cảnh báo chứng từ chưa đủ giá; null không biến thành 0. DTO thống kê chuyển numeric PostgreSQL thành số JSON trước khi render.
- Đã kiểm tra một bộ PGlite 1.000 đơn với trang 16 dòng và payload <50 KB; đây không phải benchmark production.

## Migration phải duyệt trước khi chạy production

File đầy đủ: `migrations/postgres/20261112073225_supplier_workspace.sql` (tạo bằng Supabase CLI rồi đặt vào thư mục migration chuẩn của repo).

Chỉ tạo 5 bảng mới và index của chúng: `supplier_published_stock`, `supplier_portal_invoices`, `supplier_portal_deliveries`, `supplier_portal_delivery_lines`, `supplier_transfer_shares`. Không cập nhật/xóa chứng từ hiện có, không backfill dữ liệu mẫu. File có `IF NOT EXISTS`, được kiểm tra chạy lặp.

Sau khi được anh Thái xác nhận SQL mới chạy file này qua công cụ Supabase/psql đang được cấp quyền; không in connection string/secret. Tiếp theo chạy:

```sql
BEGIN TRANSACTION READ ONLY;
-- Nội dung scripts/sql/assert-supplier-workspace.sql
COMMIT;
```

Assert kiểm tra bảng/cột/index, RLS, quyền Data API và policy. Workflow deploy API đã gắn assert này; thiếu schema sẽ dừng trước deploy. Chưa chạy SQL trên production trong lần bàn giao này.

Thứ tự đưa lên thật: duyệt SQL → chạy migration → assert chỉ đọc pass → CI đúng HEAD xanh → merge/triển khai API → triển khai UI → smoke test bằng hai NCC khác nhau và Manager. Không merge trước migration để tránh lặp tình trạng deploy bị chặn.

Rollback UI/API bằng commit release trước; để nguyên các bảng/chứng từ mới, không DROP hoặc xóa dữ liệu NCC đã nhập. Việc chạy cron, session backend, Sapo và compute/pooler giữ nguyên.

## Kiểm tra và tái chạy

```bash
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/supplier-workspace-live.test.ts tests/db/supplier-workspace-access.test.ts tests/app/supplier-portal-boundary.test.ts tests/architecture.test.ts
# Browser: truyền PLAYWRIGHT_MODULE nếu Playwright nằm ngoài repo
node --import tsx scripts/testing/supplier-workspace-live.mjs
node scripts/testing/supplier-failure-scenarios.mjs
node scripts/testing/supplier-login-review.mjs
```

Browser đi qua router, PostgreSQL/PGlite và memory Storage thật của môi trường test, gồm login qua lớp chuyển cookie/Bearer như Edge, đọc 10 trang ở 1440/390 px, cuộn mobile, upload bản ký/xác nhận, công bố tồn, thêm hóa đơn/phiếu giao, đề nghị cọc, phản hồi xin hàng, Manager đối chiếu/chia sẻ.

API tests đối chiếu `computeOrderTotals`/`supplierDebt` kể cả số lẻ và khoản bị hủy, nhận đạt/hỏng/hủy phiếu, giá thiếu, giá lọc sau CK/phí in, export/phân trang, payload SQL injection, ID/supplierId giả, ghi lặp, quyền NCC/Manager, chia sẻ/thu hồi và sửa phiếu sau chia sẻ. Migration/assert chạy read-only/lặp và có ca thiếu index/quyền sai.

Giới hạn xác minh: chưa đọc dữ liệu production, chưa xác nhận email production đến hộp thư, chưa chạy migration/deploy production. Ghi dữ liệu trong kiểm thử không tác động tiền, kho hoặc vận chuyển thật.
