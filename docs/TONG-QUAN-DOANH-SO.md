# Tổng quan doanh số

Trang `#/dashboard`, menu **Tổng quan doanh số**, gọi duy nhất `GET /api/staff/dashboard/revenue`.
Chỉ đọc; không migration, không ghi nghiệp vụ, không thay đổi lương, cron hay đồng bộ Sapo.

## Quyền và nguồn dữ liệu

- Router dùng phiên đăng nhập và khu vực `business` hiện có. Endpoint kiểm tra lại quyền; NCC, khách hàng, tài khoản không hoạt động không được vào.
- `role=manager` xem tổng công ty và lọc nhóm/nhân viên. Repo không có role Giám đốc riêng: Giám đốc cần quyền Manager hiện có. Không suy quyền quản lý từ tên chức vụ.
- Nhân viên chỉ nhận doanh số của `sales_orders.owner_id`, báo giá của `coalesce(assignee_id,creator_id)` và chăm sóc do mình ghi cho khách mình phụ trách (`customer_staff.role=owner`). Không lấy khách chỉ được chia sẻ hay log của người khác. Bộ lọc người khác/nhóm bị 403 ở server.
- Nhóm lấy từ `staff_members.position_id → staff_positions.name`, tức nhóm theo chức vụ hiện tại. Không đọc dữ liệu lương. Không có lịch sử chuyển nhóm; kỳ cũ vẫn xếp theo nhóm hiện tại. Xếp hạng và bộ lọc nhân viên chỉ lấy tài khoản còn trong trang Nhân viên (deleted_at IS NULL), không lấy NCC/khách. Tài khoản bị khoá nhưng chưa xoá vẫn hiện như trang Nhân viên. Doanh số lịch sử của nhân viên ngừng hoạt động/xoá mềm vẫn tính trong tổng công ty, nhóm và tháng; vì vậy tổng công ty có thể lớn hơn cộng các hàng đang hiện trong xếp hạng.
- `crm_tasks` là bảng cũ không sử dụng; AppSheet mirror không phải nguồn doanh số. Trang không gọi GET Công việc để tránh sinh việc tự động.

## Định nghĩa chỉ số

- Thực tế/đã chốt: tổng `sales_orders.total` gồm VAT theo `order_date` trong kỳ. Đơn huỷ không tính; đơn nháp chỉ tính khi có HĐKT `signed` hoặc `completed`. Cùng định nghĩa `debtCounts` của Bán hàng và KPI hồ sơ nhân viên. HĐKT không cộng thêm lần nữa; kiểm tra hợp đồng bằng EXISTS.
- Dự kiến: `customer_activities.expected_revenue` của lần chăm sóc mới nhất trong kỳ cho mỗi cặp khách/nhân viên; kết quả `lost` đóng góp 0. Đây là dự kiến ghi nhận trong chăm sóc, không phải mục tiêu lương, tiền đã thu hay số đơn Sapo.
- Pipeline: lần chăm sóc mới nhất đến hết kỳ cho mỗi cặp khách/nhân viên, gồm `consulting`, `quote_sent`, `negotiating`. Có thể bắt đầu trước kỳ, nhưng lần chăm sóc mới nhất phải trong vòng 90 ngày trước cuối kỳ (`PIPELINE_FRESH_DAYS`); khách để quá lâu không cập nhật không còn tính là đang theo đuổi. `won`/`lost` thoát pipeline. Ngày chăm sóc xác định theo múi giờ Việt Nam.
- Tỷ lệ chốt: số báo giá trong kỳ đã sinh đơn chưa huỷ (khi lọc nhân viên/nhóm: đơn do người trong phạm vi lọc phụ trách) / số báo giá trong kỳ, ngày báo giá (fallback ngày tạo); không có báo giá thì hiển thị —. Đây là tỷ lệ chuyển báo giá thành đơn, không phải tỷ lệ tiền đã thu.
- Đã rớt: số cặp khách/nhân viên có lần chăm sóc mới nhất trong kỳ là `lost`. Schema chưa có mã cơ hội hay quan hệ giữa một log chăm sóc và một đơn; do đó đây là **số rớt trong chăm sóc**, không tự coi mọi đơn huỷ là rớt. Cùng một khách có nhiều cơ hội riêng chưa thể phân biệt chính xác.
- Bảng tháng lấy snapshot mới nhất từng tháng. Dự kiến/rớt cả kỳ dùng snapshot cuối kỳ nên không nhất thiết bằng cộng các tháng. Thực tế, số đơn và số báo giá cộng được.
- Khách lâu chưa chăm sóc: lần trao đổi `occurred_at` gần nhất trước mốc hiện tại ít nhất N ngày, mặc định 30, hoặc chưa có log. Đây là tình trạng **hiện tại**, không phải lịch sử theo kỳ doanh số. Nhân viên chỉ xem khách mình phụ trách và log mình ghi. Manager có thể lọc theo người phụ trách khách/nhóm; xem toàn công ty chỉ tính khách đã có người phụ trách (khách đồng bộ Sapo chưa giao ai không tính).

## Thời điểm và giới hạn

- Hiển thị mốc gần nhất giữa lượt Sapo pull thành công (`sapo_health_monitor_state`, id `pull`, chỉ trích `finishedAt`) và `max(sapo_customers.synced_at)` của ID Sapo dạng số. Không dùng thời điểm cập nhật phiên/cookie. Nếu thiếu mốc, ghi rõ chưa có mốc đồng bộ.
- Mốc fallback khách hàng không bảo đảm tất cả loại dữ liệu đã đồng bộ xong; giao diện ghi rõ nguồn. Doanh số lấy đơn/HĐKT CRM hiện có, không suy doanh số từ chứng từ kho Sapo.
- Kỳ từ tháng đến tháng, tối đa 12 tháng; API mặc định tháng hiện tại Việt Nam, giao diện mặc định 6 tháng gần nhất để có xu hướng. Danh sách khách phân trang 25 dòng, tổng tính bằng COUNT trong DB.
- Toàn bộ nguồn nghiệp vụ được SUM/COUNT/GROUP BY/DISTINCT ON trong PostgreSQL, không có giới hạn 200/1000 dòng nguồn. Server chỉ cộng các dòng tổng hợp nhân viên/tháng, client không cộng doanh số. Một transaction REPEATABLE READ, READ ONLY giữ kết quả nhất quán.
- Không thêm index/schema theo ràng buộc. Nếu dữ liệu lớn, cần đo query plan trên môi trường thật để đánh giá các aggregate/snapshot chăm sóc.

## Giao diện (biểu đồ)

- Hàng bộ lọc trên cùng: kỳ nhanh (Tháng này / 3 / 6 / 12 tháng) hoặc chọn Từ–Đến; Manager thêm Nhóm, Nhân viên. Mọi biểu đồ dùng chung một bộ lọc. Khi tải lại, biểu đồ cũ mờ đi chứ không nhảy bố cục.
- Ô chỉ số: Doanh số đã chốt (số chính) + Dự kiến, Pipeline, Tỷ lệ chốt, Khách đã rớt, Lâu chưa chăm sóc.
- Biểu đồ: cột theo tháng (Thực tế so với Dự kiến, một trục VND), đường tỷ lệ chốt theo tháng (0–100%), thanh pipeline theo giai đoạn, xếp hạng nhân viên (đổi Thực tế / Dự kiến / Pipeline; ẩn khi chỉ có 1 người), doanh số theo nhóm (Manager), danh sách khách lâu chưa chăm sóc (chọn số ngày ngay trên thẻ).
- SVG dựng bằng DOM API (`createElementNS` + `textContent`), không chuỗi HTML, không thư viện ngoài. Rê chuột / chạm / Tab để xem tooltip; mỗi biểu đồ có "Bảng số liệu" để đọc đủ giá trị không cần rê chuột. Màu đã kiểm tra mù màu: Thực tế xanh `#2a78d6`, Dự kiến cam `#eb6834`, giai đoạn pipeline là thang xanh nhạt → đậm.

## Kiểm thử

`tests/app/dashboard.test.ts`: phiên/quyền, chặn đổi owner/group, phương thức ghi 405, 1.001 đơn không bị cắt tổng, loại nháp/huỷ và tính hợp đồng ký một lần, snapshot chống cộng trùng, biên ngày Việt Nam, nhóm từ DB, tổng/phân trang khách, không trả JSON giám sát Sapo thô, UI không innerHTML/token persistence.

Chạy `npm run typecheck` và `npm test`. Test PostgreSQL dùng PGlite và migration có sẵn, không truy cập hay sửa database production.
