# Hàng đang về theo mã — Bước 0

Ngày đối chiếu: 21/10/2026. Base main `82f2032`. Ban đầu cổng Bước 0 phát hiện lệch và đã báo/dừng. Sau khi người dùng yêu cầu tiếp tục, đã sửa phần đọc và triển khai Bước 1–2; **chưa hoàn thành bước gửi NCC, đang chờ duyệt schema**. Chỉ đọc production qua Supabase; không thay dữ liệu, schema, công thức tồn hay cron.

## Phạm vi đã đọc

`docs/NCC-PAGE.md`, `docs/NCC-ACTIONS.md`, `trial-ui/purchases.js`, `suppliers/api/purchase-routes.ts`, `purchase-store.ts`, `incoming-stock.ts`, `suppliers/domain/purchasing.ts`, `suppliers/schema.ts`, `inventory/api/routes.ts`, phần `supplierPurchases` trong `tasks/api/auto-tasks.ts`.

## Route, dữ liệu và quyền hiện có

| Phần | Nguồn hiện tại | Ghi chú |
|---|---|---|
| Danh sách/chi tiết đơn | `#/purchases`, `#/purchases/:id`; `GET /purchase-orders`, `GET /purchase-orders/:id` | Area business + `canUsePurchasing` và `purchaseScope`; giữ nguyên |
| Tra tồn | `GET /inventory/lookup?q=`; `incomingLookup.read` được gắn với `outstandingLines` | Tìm tối đa 80 sản phẩm; chi tiết hàng về tính trên các SKU tìm được; không có endpoint tổng hợp toàn bộ SKU |
| Đơn mua | `incoming_shipments` | `source='supplier-order'`, `approval_status='approved'`, `cancelled_at IS NULL` |
| Số đặt/ĐVT | `incoming_shipment_lines.quantity`, `.unit` | SKU là chuỗi, giữ số 0 đầu; tên/ĐVT lấy từ dòng đơn, không đoán |
| Số nhận | `supplier_receipt_lines.good_qty`, nối `supplier_receipts.cancelled_at IS NULL` | Hàng hỏng không tính là đã nhận đạt |
| Hủy/trả | Hủy cả đơn bằng `incoming_shipments.cancelled_at`; hủy phiếu nhận bằng `supplier_receipts.cancelled_at` | Chưa thấy cột lượng hủy/trả từng dòng trong công thức hiện tại. Không tự trừ `damaged_qty` hay `delivered_quantity` |
| Công thức | `receiptProgress`, `outstandingLines` | `max(0, quantity - sum(good_qty của phiếu chưa hủy))` |
| Ngày hẹn | `incoming_shipment_lines.promised_date`, `incoming_shipments.arrival_date` | Helper Tra tồn hiện chỉ trả ngày cấp đơn; trang mới cần ngày từng dòng, fallback ngày đơn |
| Chứng từ nguồn | `supplier_order_sources` | Excel tạo `sources: []`; không được dùng inner join nguồn để lọc hàng đang về |
| Nhận diện nhập Excel | `supplier_order_events.action='import'` | Không được suy ra Excel chỉ vì không có nguồn; đã kiểm event import cho đơn lệch và hai đơn của 031106000 |
| Yêu cầu cũ | `supplier_stock_requests`, `supplier_stock_request_lines` | Header có pending/accepted/rejected; dòng bắt buộc shipment_id, chưa có phản hồi từng dòng hoặc khóa idempotency |
| Cổng NCC | Đặc tả ghi `/supplier`, `/supplier-portal/orders`, `/supplier-stock-requests` | Không tìm thấy route triển khai tham chiếu hai bảng xin hàng trong `src`; không coi bảng/đặc tả là cổng đã hoạt động |

`canUsePurchasing`: Manager hoặc nhân viên active, loại NCC/khách. Sale, Kho, Kế toán, Sale Admin giữ quyền theo actor hiện tại; không thêm quyền mới. Trang mới chỉ lấy đơn đã duyệt nên không làm lộ đơn nháp/giá/tên khách. Quyền gửi mới theo yêu cầu là Manager/Sale Admin; chưa triển khai, chưa kiểm runtime. Không mở quyền duyệt thay NCC.

## Đối chiếu năm mã từ dữ liệu gốc

Đã đọc tất cả dòng đơn đủ điều kiện và phiếu nhận tương ứng, không cắt trang. Cột helper là SQL mô phỏng chính xác bộ lọc/join của `outstandingLines`, **không phải kết quả gọi HTTP API production** (chưa có phiên đăng nhập để gọi). Tất cả dòng mẫu dưới đây có số nhận đạt = 0.

| SKU | Cộng tay số còn về từ các đơn | Tổng gốc | Theo truy vấn helper hiện tại | Số đơn còn hàng | Kết quả |
|---|---|---:|---:|---:|---|
| 031106000 | 10.000 + 10.000 | 20.000 | 20.000 | 2 | Khớp tổng, dữ liệu thật không phải 3 đơn |
| 01654020803 | 10 | 10 | 0 | 1 | **Lệch 10** |
| 042513000 | 3.000 + 3.000 + 3.000 + 2.000 + 2.000 | 13.000 | 13.000 | 5 | Khớp |
| 031199000 | 1.450 + 150 + 5.000 + 5.000 | 11.600 | 11.600 | 4 | Khớp |
| 022505000 | 2.000 + 2.000 + 3.000 + 2.000 | 9.000 | 9.000 | 4 | Khớp |

031106000: `DMH_20261016_005` (DDLT0081/0726) và `DMH_20261016_007` (DDLT0085/0726), mỗi đơn 10.000 Cái, không có chứng từ nguồn; cả hai có event import. Ví dụ 20.000 trong 3 đơn phải dùng fixture riêng, không sửa production để khớp mockup.

01654020803: `DMH_20261016_058` (DDLT0915/0926), đặt 10, chưa nhận, đã duyệt/chưa hủy; có event import và không có nguồn. SKU chưa có trong `products`, ĐVT dòng trống. `outstandingLines` inner join `products` nên loại dòng này. Đây là nguyên nhân cụ thể khiến đơn Excel bị bỏ sót; thiếu chứng từ nguồn tự nó không phải điều kiện loại.

## Đề xuất xử lý sau khi báo lệch

Tái sử dụng một helper đọc số còn về từ dòng đơn và phiếu nhận, bao gồm SKU chưa có danh mục; catalog chỉ bổ sung dữ liệu bằng left join. Giữ `syncIncomingStock` chỉ ghi SKU tồn tại trong catalog vì khóa ngoại `product_stock`, không thay công thức tồn. Giữ ĐVT thiếu là chưa có dữ liệu; gắn nhãn “Nhập Excel, thiếu chứng từ” dựa event import + không có nguồn.

Lần đối chiếu đầu đã dừng/báo lệch trước khi sửa. Sau chỉ đạo tiếp tục, helper đã được sửa theo phương án trên; kiểm thử đối chiếu năm mã đạt, bao gồm mã trước đây bị loại. Không thay số liệu production để khớp fixture.

## Schema / quyết định cần chốt trước bước ghi

Chưa tạo migration. Hai bảng xin hàng cũ không đủ cho yêu cầu một lần gửi, một dòng mỗi SKU, phân bổ nhiều đơn/NCC, phản hồi từng dòng và chống bấm đúp. Chưa chốt thiết kế bảng/cột vì cổng dữ liệu chưa đạt; phải lập danh sách schema đầy đủ và xin duyệt trước khi tạo migration.

Một SKU có thể thuộc nhiều NCC; một yêu cầu nhiều SKU cần tách phạm vi xem/phản hồi theo NCC và phân bổ lượng theo đơn. Cần chốt quy tắc phân bổ (đề xuất ngày hẹn sớm nhất trước, thiếu ngày hẹn sau cùng; không vượt lượng còn về). Không để NCC nhìn thấy dòng của NCC khác. Không gắn đơn khách hoặc tự duyệt.

Các mặc định theo prompt: không vượt số còn về; Sale Admin không duyệt thay NCC; quyền xem giữ nguyên. Chưa chốt danh sách vai trò xem riêng ngoài quyền hiện tại, cách phân bổ khi nhiều NCC, xử lý nhiều yêu cầu xin trước còn mở cùng một SKU.

## Link, action, automation, kiểm thử

| Hạng mục | Kết quả |
|---|---|
| Link chi tiết đơn mua | Route và purchaseScope đã đọc; chưa test Chromium/HTTP |
| Link NCC / Tra tồn | Chưa thay; chưa kiểm thao tác trình duyệt |
| Cổng NCC, phản hồi từng dòng | Chưa có triển khai xác minh được; chưa test cổng thật |
| Lưu/idempotency/vượt lượng | Chưa làm do dừng ở Bước 0 |
| Automation | Hiện có task theo đơn mua: chờ duyệt, xác nhận, quá hẹn, nhận hàng, nhập Sapo, trả NCC; chưa có action gửi mới nên không kích hoạt task nào trong đợt kiểm tra |
| Quyền server theo từng vai trò | Đã đọc guard/scope, chưa thêm API và chưa chạy test ma trận |
| SQL chỉ đọc production | Đã đối chiếu 5 SKU và kiểm event import cho 3 đơn liên quan |
| Typecheck/full suite/Chromium 1440,1280,390 | Chưa chạy; chưa đến Bước 5, chưa sửa code |

## Cập nhật sau chỉ đạo tiếp tục

- `outstandingLines` đọc cả SKU ngoài catalog và thông tin dòng (ĐVT/ngày hẹn), import event và thiếu nguồn; `syncIncomingStock` chỉ ghi SKU trong catalog như trước, giữ FK và công thức.
- `GET /purchase-incoming` chỉ đọc, có guard giống trang mua hiện tại; tổng hợp trên toàn bộ dòng đủ điều kiện trước phân trang; trả KPI mã/SL/NCC/đơn quá hẹn; lọc mã/tên/NCC/ngày/quá hẹn/7 ngày/đã chọn. Không trả giá hay thông tin đơn khách. `canRequest` chỉ Manager/Sale Admin; `canSend=false` vì chưa có bước ghi.
- Tab đọc mới theo mockup: 4 KPI từ API, bộ lọc, bảng, mở từng SKU xem đơn, chọn nhiều mã/SL; số nguyên dương không vượt còn về, nhãn Excel thiếu chứng từ. Giữ trạng thái bộ lọc và chọn trong instance khi mở chi tiết đơn rồi quay lại.
- Chưa có POST gửi/response/portal. Nút gửi khóa và có thông báo chưa gửi; không giả lập thành công. Chưa tạo migration. Chi tiết 3 bảng cần duyệt ở `PURCHASE-EARLY-REQUESTS-SCHEMA.md`.

### Bảng đối chiếu sau sửa (fixture từ lượng gốc đã đọc)

| SKU gốc | Tính tay | Helper mới | Số đơn |
|---|---:|---:|---:|
| 031106000 | 20.000 | 20.000 | 2 |
| 01654020803 | 10 | 10 | 1 |
| 042513000 | 13.000 | 13.000 | 5 |
| 031199000 | 11.600 | 11.600 | 4 |
| 022505000 | 9.000 | 9.000 | 4 |

Fixture đối chiếu trên dùng tiền tố AUDIT- để tách dữ liệu thử; không thay SKU production. Fixture riêng dùng đúng SKU 031106000 = 8.000 + 7.000 + 5.000, 3 đơn: helper/API trả 20.000 và đủ 3 đơn. Test nhận đủ/hủy/nháp bị loại, phiếu nhận hủy không trừ, hỏng không trừ, ngày hẹn dòng ưu tiên, tổng trước phân trang, lọc và validate query, 6 vai trò và chưa đăng nhập đều đạt. GET không tạo yêu cầu.

### Kiểm tra thực hiện / chưa thực hiện

| Hạng mục | Kết quả hiện tại |
|---|---|
| API đọc và quyền | Test tích hợp đạt: Manager/Sale Admin/Sale/Kho/Kế toán xem, NCC 403, chưa login 401; quyền chọn chỉ Manager/Sale Admin |
| Link chi tiết đơn | Chromium xác minh đúng ID và `?mode=incoming`; quay lại giữ số nhập/filter; không thực hiện action trên đơn |
| Link NCC, Tra tồn, cổng NCC | Chưa bổ sung/kiểm hết; dừng trước bước ghi/link hoàn chỉnh |
| Lưu / gửi / phản hồi / idempotency / audit mới | Chưa triển khai, chờ duyệt schema; không có test pass giả cho chức năng chưa có |
| Automation | GET mới không gọi sync/tạo task; test GET không ghi yêu cầu. Chưa có POST gửi nên chưa kiểm automation sau gửi |
| Typecheck và UI build | Đạt |
| Chromium 1440/1280/390 | Đạt đọc/chọn nhiều mã/validate vượt/mở 3 đơn/giữ lựa chọn/không tràn trang; dữ liệu nguồn render bằng DOM text, không thực thi HTML; chỉ bảng cuộn trên mobile |
| Full suite | 731 test: **699 pass, 2 fail, 30 skip**. Hai fail là architecture `sales/api/packing-routes.ts` import suppliers không được phép và `tests/db/reset-test-data.test.ts:48` (409 thay vì 201). Đã chạy lại hai file trên main nguyên bản 82f2032 và tái hiện cùng lỗi. Không sửa ngoài phạm vi; cổng full suite chưa đạt |
| Live / NCC thật / Sapo / máy in | Chỉ đối chiếu SQL production; chưa test luồng ghi/cổng thật, không gọi Sapo/máy in |

Do chưa duyệt schema, không báo hoàn thành toàn bộ luồng. Không migration, không thao tác nghiệp vụ production, không sửa cron.

### Sửa chặn merge theo yêu cầu tiếp theo

PR #205 không có xung đột; ban đầu là draft. Theo yêu cầu “chưa merge được”, sửa hai lỗi kiểm tra có sẵn mà không đổi nghiệp vụ: lấy danh sách NCC tối thiểu qua dependency do app gắn vào route đóng gói (bỏ import sales → suppliers gây vòng), và cập nhật fixture reset-test-data để Manager xác nhận `costWarningsReviewed` theo luồng duyệt hiện có, kiểm status thành công thay vì bỏ qua lỗi. Không nới kiểm tra kiến trúc hay bỏ test.

Typecheck đạt. Chạy lại 4 file architecture/reset-test-data/purchase-discount-review/purchase-incoming: 10 pass, 0 fail, 0 skip. Kết quả full suite 699/2/30 ở trên là trước lần sửa chặn merge này; CI sẽ chạy lại toàn bộ trên commit mới. Phần merge được giới hạn API/UI đọc; gửi NCC vẫn khóa và chờ duyệt schema, không đánh đồng ready-for-review với hoàn thành toàn bộ prompt.

### File thay đổi

`src/modules/suppliers/api/incoming-stock.ts`, `incoming-by-sku.ts`, `purchase-routes.ts`; `trial-ui/purchases.js`, `purchase-incoming.js`, `style.css`; `tests/app/purchase-incoming.test.ts`; `docs/PURCHASE-INCOMING-BY-SKU-PREFLIGHT.md`, `PURCHASE-EARLY-REQUESTS-SCHEMA.md`.

Sửa chặn merge bổ sung: `src/app/router.ts`, `src/modules/sales/api/packing-routes.ts`, `src/modules/suppliers/api/directory-routes.ts`, `tests/db/reset-test-data.test.ts`.
