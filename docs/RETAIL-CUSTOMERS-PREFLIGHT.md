# Đồng bộ bổ sung khách lẻ và bộ lọc Khách lẻ

## Yêu cầu đã chốt

- Lấy khách lẻ từ Sapo sang CRM/POS: nhận khách trong nhóm Khách lẻ trên Sapo **hoặc** khách cá nhân không có MST.
- Khách đã có: bỏ qua, không cập nhật hồ sơ, không tạo bản sao. Chỉ thêm khách lẻ chưa có.
- Nhận diện tồn tại: ID Sapo, mã khách hàng nếu có và điện thoại chuẩn hoá (đối chiếu thận trọng; xung đột đưa vào thống kê bỏ qua, không tự gộp). Không tự gộp theo tên vì có thể trùng người.
- Nhân viên NVBH LOCK / NVBH ML được xem nhóm Khách lẻ trong danh sách và bộ chọn khách POS. Các chức vụ nhân viên khác ẩn nhóm này mặc định cho gọn; không phá quyền xem chứng từ/liên kết khách đã tồn tại.
- Manager vẫn xem tất cả và có bộ lọc để quản lý. Không thay quyền khách doanh nghiệp.

## Hiện trạng đã xác minh

- `isEligibleSapoCustomer` hiện chỉ nhận khách có MST và tên không phải Khách lẻ; `syncCustomers` không tạo mới nhóm còn lại.
- `sapo_customers` production chưa có cột phân loại khách lẻ (đã đọc information_schema, chưa ghi DB).
- Danh sách CRM ở GET /customers, bộ chọn POS ở GET /pos/customers; cần cùng bộ lọc phía server để tìm kiếm/phân trang không trả khách bị ẩn.

## Đề xuất schema cần duyệt trước khi tạo migration

- Không thêm bảng hoặc quyền mới.
- Thêm duy nhất `sapo_customers.is_retail boolean NOT NULL DEFAULT false`.
- Migration mới sinh bằng Supabase CLI sau khi anh duyệt; không sửa migration cũ, không sửa RLS/grant hiện có.
- Migration chỉ thêm cột; không phân loại hàng loạt hay ghi đè khách đã có. Khách mới nhập trong đợt bổ sung sẽ có is_retail=true.
- Không dùng điều kiện thiếu MST để thay đổi các khách doanh nghiệp đã có. Với nguồn Sapo, nhóm Khách lẻ là bằng chứng trực tiếp; nhánh thiếu MST chỉ áp dụng khách cá nhân, không suy diễn mọi tổ chức thiếu MST thành khách lẻ.

## File/module dự kiến thay đổi

- src/modules/customers/schema.ts: cột isRetail.
- src/modules/customers/domain/customer-config.ts hoặc helper riêng: quy tắc xem nhóm khách lẻ theo chức vụ.
- src/modules/customers/api/routes.ts: bộ lọc danh sách, tìm kiếm, tổng/phân trang.
- src/modules/integrations/domain/sapo-mapping.ts: nhận diện khách lẻ theo nhóm và loại cá nhân, chuẩn hoá khoá chống trùng.
- src/modules/integrations/api/sapo-sync-routes.ts: hàm nhập bổ sung chỉ insert, không update khách có sẵn; tách khỏi đồng bộ doanh nghiệp hiện tại.
- src/modules/integrations/api/sapo-pull.ts hoặc module bổ sung: quét khách Sapo đầy đủ theo trang, có điểm tiếp tục riêng; không reset con trỏ tồn kho/nhân viên và không sửa cron.
- src/modules/sales/api/pos-routes.ts: bộ chọn khách POS áp dụng cùng phạm vi và bộ lọc.
- trial-ui/index.html, trial-ui/app.js, trial-ui/pos.js: bộ lọc Khách lẻ và hiển thị theo phản hồi server.
- docs/KHACH-HANG.md, docs/POS.md và tests liên quan mapping/sync/khách/POS/quyền.

## Thực hiện và xác minh sau duyệt

1. Viết code và test với dữ liệu giả; test đồng bộ lặp không thêm trùng, không sửa hồ sơ có sẵn, không nhập doanh nghiệp; test phân trang và ẩn theo chức vụ.
2. Chạy typecheck và kiểm thử phù hợp; tạo PR có migration mới để review.
3. Áp dụng migration theo phạm vi được duyệt rồi triển khai.
4. Đồng bộ bổ sung toàn bộ các trang khách lẻ bằng phiên Sapo sẵn có. Chỉ báo hoàn tất khi đã hết trang; báo số đọc, thêm mới, có sẵn, nghi trùng và lỗi. Không in dữ liệu liên hệ hoặc credential ra log.

Anh đã duyệt phương án. Migration 20261019030603_retail_customers.sql đã chạy trên Supabase taceqfnsorewelsbdckg: thêm duy nhất is_retail, RLS vẫn bật, tổng khách trước nhập vẫn 1.967 và is_retail=0. Chưa nhập khách ở thời điểm ghi nhận này.
