# #801 · Việc 1 B1 · Phạm vi đơn mua NCC

## Chính sách đã duyệt

Manager hoạt động xem toàn bộ; nhân viên Kế toán có `page.purchases` xem toàn bộ; Sale Admin có quyền trang chỉ xem NCC được Manager chọn `sale_admin_brand`. Các chức vụ khác bị chặn kể cả là người tạo hoặc được bật cờ duyệt. Không suy luận hãng từ tên NCC, không seed hãng production.

Adapter SQL dùng cùng domain policy trước danh sách/count/phân trang và kiểm parent trước mutation/replay/upload. Phiếu lấy trước trộn NCC ngoài scope bị 404 toàn bộ. Không đổi `syncIncomingStock`, worker/cổng NCC và các phép kiểm ngân sách nguồn toàn cục.

Kho dùng `/warehouse-receiving` và DTO whitelist (SKU, số lượng, ngày/phiếu nhận, trạng thái Sapo), không mở PO thương mại. Kiểm kho hoạt động, phân công kho hoặc nhiệm vụ nhận đích danh; kiểm lại trong transaction nhận. Mã chống lặp và kiểm lượng nhận cũ được giữ. Nhiệm vụ hoàn tất vẫn được đọc ngữ cảnh để retry mất ACK, không làm nhận vượt số thiếu. Bộ đếm nhận dùng cùng predicate còn thiếu.

## Bằng chứng trước / sau

Test mới đầu tiên trên main c37c9683: Sale có quyền trang cũ GET `/purchase-orders` trả 200, test đòi 403 thất bại. Sau sửa: test vai trò/phạm vi, thu hồi hãng, NCC giả tên hãng, replay ngoài scope, mixed early, audit hãng và nhận hàng đúng kho đạt. Fixture nhận hàng cũ bổ sung phân công kho đích rõ ràng; các positive test tạo/sửa PO dùng Sale Admin thay Sale. Các negative test vai trò cũ chuyển sang kỳ vọng chặn, không nới quyền.

Chromium 390/1280 dùng API thật nối PGlite cục bộ: Manager chọn hãng, Kế toán không có control sửa hãng, Kho chỉ thấy dữ liệu tác nghiệp, mất phản hồi sau khi server lưu vẫn giữ form; gửi lại cùng payload/clientKey chỉ có một phiếu nhận. Tên chứa thẻ HTML hiển thị dạng văn bản. Không có dữ liệu production hay request tích hợp thật.

## Migration và thứ tự triển khai

1. Review/merge theo điều phối (Codex không tự merge).
2. Người được duyệt chạy `migrations/postgres/20261123201607_purchase_supplier_sale_admin_brand.sql` trước deploy API. Transaction có lock_timeout 5s; không backfill, không thêm index.
3. Chạy cổng chỉ đọc `scripts/sql/assert-purchase-sale-admin-brand.sql`; deploy-api và November coverage đã thêm cổng này.
4. API rồi UI cùng thay đổi. Manager phân hãng bằng form Danh bạ NCC có audit; trước khi phân, Sale Admin không thấy PO của NCC chưa phân hãng.

Rollback: quay API/UI về bản đã xác minh; giữ nguyên cột nullable và CHECK để không mất cấu hình. Không tự DROP cột trên production. Rollback API cũ phục hồi quyền đọc rộng trước đây, cần cân nhắc về bảo mật. B2 có phụ thuộc policy/schema B1; không rollback riêng B1 khi API B2 vẫn dùng schema/policy mới.

## Giới hạn / chờ phối hợp

Projection title/description/link nhiệm vụ ở `src/modules/warehouse-workspace/routes.ts` đã được duyệt và kiểm chứng Kho/Manager (chi tiết cuối báo cáo). Điểm mapping kho nhận bên dưới vẫn chờ điều phối. B2 còn xử lý projections ngoài module (history/lookup/catalog/POS/quote/order/customer/stock moves); B1 không thay frontend POS hoặc SePay.

PGlite kiểm logic/SQL, không chứng minh tranh chấp nhiều kết nối PostgreSQL thật. Chưa thử Safari/điện thoại thật, chưa migration/deploy/kiểm tra CRM production. Không gửi email, push hay gọi Sapo/GHN/SePay/Drive thật.

### Cập nhật từ CI toàn repo

CI đầu tiên chưa xanh. Đã sửa fixture của accounting/crm-audit/customer supplier/flow/inventory/warehouse calendar/sales và lifecycle theo actor/hãng/kho được phân công; các lượt test con sau sửa được ghi trong issue. Chưa coi toàn bộ các test purchasing cũ đạt: `purchasing.test.ts` vẫn dựa vào Sale tạo PO/Kho mở DTO thương mại và địa chỉ giao tự do. Cần chốt riêng nguồn kho nhận có cấu trúc trước khi hoàn thiện queue cho đơn cũ; không sửa fixture để che việc mất đường nhận hàng.

`incomingShipments.warehouse` hiện là `deliveryAddress()` (địa chỉ chữ tự do), không phải kho stock chuẩn. B1 fail-closed khi không ánh xạ được và đã xin điều phối chọn `receivingWarehouseId` mới hoặc metadata source-assignment đã có. Chưa thêm migration hoặc tự đoán ánh xạ.

Test POS số đơn lỗi ranh giới UTC/VN đã tái hiện trên origin/main c37c9683; báo ngoài làn, chưa sửa. Không đổi công thức/đếm số nghiệp vụ để né test.

Projection GET `/warehouse-workspace` đã được duyệt ở comment7114065030 và bổ sung vào B1; test Kho ẩn title/description/link thương mại, Manager cùng task giữ đầy đủ đạt, cùng warehouse-workspace/architecture đạt. Không đổi phân công/cách chạy việc/tính hiệu suất. Điểm mapping kho nhận và các fixture/CI cũ vẫn chưa đóng nên chưa bỏ draft.

CI SHA1993: shard1 đạt; shard2 lỗi contract-stock-holds do fixture nay có phân công sale→vig (đã xin phối hợp chỉnh đoạn kiểm người ngoài kho private); shard3 lỗi baseline POS ngày VN; shard4 còn purchasing/warehouse-work theo quyền/kho cũ. Đã cập nhật actor tạo PO trong pos-stock-sources sang Manager (giữ không cộng nháp vào hàng về), và sale-admin-scope dùng hãng được cấu hình + thêm từ chối NCC chưa phân hãng. Hai file cùng architecture rerun3/3 đạt. Không thay code tiền/tồn hoặc mở rộng quyền.

## Chốt kho nhận theo điều phối 7116601696 / 7117746286

Đã merge main (gồm #815 sửa ngày POS theo VN) lần lượt vào B1 → B2 → Việc2 bằng merge commit. Bổ sung `incoming_shipments.receiving_warehouse_id` nullable FK warehouses vào chính migration B1 chưa chạy, cùng assert chỉ đọc kiểm nullable/FK. Không backfill hoặc suy từ địa chỉ.

Form tạo/sửa nháp có dropdown kho stock đang hoạt động. Đơn cũ có mục “Kho nhận hàng…” cho Manager/người lập đủ quyền mua; endpoint kiểm lại role ceiling, người lập, revision, kho active/stock và ghi audit trước/sau. Đơn đã có phiếu nhận giữ kho để đối soát, không chuyển lịch sử bằng endpoint này. Gán kho không thay giá, số lượng hay trạng thái xác nhận NCC.

Kho có `purchases.receive`: đơn có kho chỉ đúng phân công warehouse_sellers được mở/nhận; task được giao không vượt giới hạn kho. Đơn NULL hiện DTO “Chưa chọn kho nhận”, không giá/số PO/NCC; người nhận phải chọn một kho stock được phân công. Kiểm lại đích nhận trong transaction, kể cả trước replay. Không cho trùng tên kho mơ hồ. Kho không mở danh sách/chi tiết thương mại hoặc calendar early cũ. Các test luồng thương mại chuyển sang Manager/Sale Admin thuộc hãng, giữ Sale thật làm actor âm.

Test mới đỏ trước sửa (view thiếu receivingWarehouseId), xanh sau: đích đúng phân công, sai phân công404, NULL queue và nhận/retry vào kho được phân công; audit đổi kho; kho supplier bị400. Hồi quy nhập đơn nhận hàng bằng Kho phát hiện nhánh DTO bỏ sót syncIncomingStock; đã khôi phục bước cập nhật toàn cục như viewOf cũ, không thay phép tính. contract-stock-holds gỡ sale→vig riêng trước kiểm người ngoài không thấy, vẫn kiểm người được phân công thấy16.

Các ghi chú “chờ mapping/chờ duyệt file” bên trên là diễn tiến cũ, đã được giải quyết theo comment mới. Trạng thái CI chính xác báo ở PR/issue theo head mới nhất; chỉ bỏ draft khi CI #812 xanh. Chưa chạy migration/deploy/production; chưa PostgreSQL nhiều kết nối, Safari hoặc thiết bị thật.
