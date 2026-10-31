# Đơn vị làm việc, phòng ban, Leader

Trang Nhân viên có cột Làm việc tại (Bách Ngân / VIGIFTS), Phòng ban và nhãn Leader. Nút Đơn vị & phòng ban mở hộp sửa riêng, hiển thị trực tiếp cả trên điện thoại. Manager có thể sửa thông tin tổ chức của chính mình mà không đi qua luồng đổi chức vụ / khóa tài khoản.

- Chỉ Manager sửa, kiểm tra trên server; từ chối khách hàng, NCC, hồ sơ đã xoá và phòng ban không tồn tại. Có nhật ký trong cùng transaction.
- Dùng danh mục phòng ban hiện có. Phòng ban nhân viên phục vụ hiển thị/lương, không thay phòng ban phân quyền của chức vụ. Leader không cấp quyền, không tự tăng phụ cấp, không thay cách chia thưởng team.
- Không tự gán công ty cho hồ sơ cũ. Manager chọn đúng công ty trước khi chốt kỳ mới.
- Phiếu lương mới lưu đơn vị, tên phòng ban, Leader vào snapshot khi chốt; đổi thông tin nhân viên / tên phòng ban về sau không làm đổi snapshot đó.
- In phiếu dùng đúng tên pháp nhân BN/VG đã có trong mẫu HĐKT. Excel tách theo đơn vị và nhóm lương, hiện đúng chủ thể; sheet Tổng hợp / Chuyển khoản vẫn tổng hợp nhiều đơn vị.
- Phiếu cũ chưa có snapshot đơn vị in rõ chưa được ghi nhận, không lấy công ty hiện tại để đoán pháp nhân kỳ cũ. Không sửa dữ liệu phiếu đã chốt.

## Migration và triển khai

`migrations/postgres/20261031230043_staff_employment.sql` thêm ba cột trên staff_members; giữ nguyên RLS/quyền hiện có. work_company và work_department_id mặc định NULL, is_leader=false. Migration chỉ viết và kiểm thử trên PGlite, chưa chạy production.

**Chạy tay migration này trước khi merge/triển khai API mới.** Code mới đọc các cột mới nên không triển khai trước migration. Không thêm migration vào danh sách tự chạy của workflow. Migration không backfill doanh nghiệp hay thay đổi dữ liệu lương. Sau migration, triển khai API rồi giao diện theo quy trình hiện có.

## Kiểm chứng

- Typecheck, cú pháp JS, diff check đạt.
- 5 file test Node22.22.0/concurrency2: staff-employment, staff-hub, sale-kpi-net, architecture, trial-ui đạt. Test API xác minh quyền, dữ liệu không hợp lệ, Leader không cấp quyền duyệt, thay đơn vị sau chốt giữ nguyên chủ thể kỳ cũ.
- Sửa hai dữ liệu kiểm thử cũ phụ thuộc đồng hồ: staff-hub cố định ngày trong kỳ; helper thưởng thanh lý cố định reviewedAt trong kỳ dữ liệu mồi. Không thay logic ngày / thanh lý production.
- Playwright Chromium + router/PGlite thực trên 1280/390 px: sửa hồ sơ VG/phòng ban/Leader, in phiếu có pháp nhân VIGIFTS, xuất Excel và đọc lại nội dung XLSX để xác nhận sheet VG / pháp nhân đúng; không lỗi JS. Ảnh và results.json chỉ chứa dữ liệu giả lập.
- Chạy lại: `PLAYWRIGHT_MODULE=<path-to-playwright> node --import tsx scripts/testing/staff-employment.mjs`.

Không truy vấn production; không thay Sapo/cron, công thức KPI, bậc thưởng Sale hay Lock/ML trong PR này.
