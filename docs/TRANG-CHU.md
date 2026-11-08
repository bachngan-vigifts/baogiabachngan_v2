# Trang chủ CRM

Route `#/home`, theo phương án 1 đã chọn: tóm tắt công việc → 5 việc ưu tiên → thao tác nhanh / thông báo → các nhóm chức năng hiện có. PC dùng hai cột, mobile một cột và thẻ số liệu 2×2. Giữ menu nhóm chân trang hiện tại; nút Trang chủ ở header, mục Trang chủ ở sidebar.

## Luồng và dữ liệu

- Đăng nhập mới từ màn hình chung vào Trang chủ cho mọi tài khoản nội bộ. Link mở trực tiếp chứng từ/công việc được giữ; mở lại phiên đang làm tiếp tục ở trang hiện tại. Khách/NCC vẫn đi portal riêng. Route không hợp lệ trở về `#/home`.
- `GET /tasks/home?filter=priority|overdue|today` trả số đếm toàn bộ việc đang mở trong phạm vi và tối đa 5 dòng. Không tính số đếm từ danh sách giới hạn 500 dòng. Ưu tiên quá hạn → hôm nay → mức ưu tiên → hạn/giờ → mã ổn định. Không có giá vốn, công nợ, mô tả hoặc dữ liệu liên hệ trong projection này.
- Manager: toàn bộ công việc được quản lý. Nhân viên: việc nhận và việc nhóm mình chưa ai nhận, dùng cùng `visible/viewCond` của module Công việc. Client không đổi phạm vi bằng tham số `view/assignee/limit`. Khu vực `business` chặn khách/NCC và người chưa đăng nhập.
- Chờ duyệt chỉ hiện cho Manager/người có cờ duyệt. Dùng chung approval feed với hộp Cần duyệt, lấy số đếm chính xác của API hiện có; không suy ra từ danh sách đã giới hạn.
- Các thẻ và Xem tất cả mở bảng Công việc với đúng phạm vi và bộ lọc, xoá các bộ lọc cũ. Thao tác tạo mới dùng form Công việc/Báo giá/Khách hàng/Chăm sóc hiện có; NVBH có lối tắt POS. Không tạo nghiệp vụ ghi riêng.
- Nhóm chức năng lấy từ menu thực tế đã lọc quyền, cập nhật khi menu thay đổi. Tìm không dấu trên nhãn chức năng/nhóm, không gọi API tìm kiếm. Không tự cấp quyền qua Trang chủ.
- Thông báo mới dùng API cá nhân hiện có; ba mục gần nhất. Chuông và Trang chủ gộp lượt đọc ban đầu qua feed trong bộ nhớ tối đa 3 giây, không lưu thông báo ra storage. Đánh dấu đọc khi bấm mục cập nhật cả chuông sau khi API thành công.
- Snapshot Home không được cache thành chi tiết công việc ở sessionStorage. Đổi tài khoản/quyền bỏ dữ liệu, request cũ và snapshot thông báo cũ. Lỗi tải hiển thị rõ và cho thử lại; chưa tải được hiện `—`, không giả số 0. Các thời điểm công việc theo ngày Việt Nam từ máy chủ.

## Hiệu năng

- Module JS/CSS Home tải khi mở route, không thêm thư viện. Một ít CSS giữ chiều cao/header có sẵn từ đầu để vùng chừa chat không làm dịch chuyển bố cục.
- Không tải trước toàn bộ báo giá, khách, nhân viên, catalog hoặc bảng 500 công việc khi vào Home. Các trang đó tải khi người dùng mở. Báo cáo doanh số/KPI vẫn ở Tổng quan.
- Projection công việc dùng hai truy vấn theo lô: aggregate và top 5 với join tên nhân viên, không N+1. Dùng các index tasks hiện có. Không cần migration.
- Giữ cơ chế đồng bộ việc tự sinh/waitUntil hiện có; không tạo thêm scheduler. Hai truy vấn trên không bao gồm xác thực và đồng bộ nền của module sẵn có.
- Home dùng nhịp thay đổi hiện tại, nút Làm mới, đổi bộ lọc và qua ngày; không thêm polling danh sách riêng. Khi refresh Home không tải lại các danh sách chứng từ khác.

## Kiểm chứng

Theo `tests/TEST_TEMPLATE.ts`: `home-api.test.ts`, `home-ui.test.ts`, cập nhật test điểm vào `sales-login-home.test.ts`; giữ các kiểm tra menu/kiến trúc/phiên/cache hiện có. API test có hơn 550 việc, sai quyền, sửa tham số phạm vi, việc riêng, việc nhóm, trạng thái đã xong và thứ tự hạn.

Browser dùng toàn bộ CRM, router thật, Postgres test cô lập; dữ liệu minh hoạ chỉ tồn tại trong fixture, không đưa vào giao diện production:

```
node --import tsx scripts/testing/home-browser.mjs flows
node --import tsx scripts/testing/home-browser.mjs release
```

Flow: 7 chức vụ, đăng nhập thật, link trực tiếp, mở form hiện có/tạo công việc, POS, lọc quá hạn, tìm chức năng, đọc thông báo, lỗi mạng, phản hồi về sai thứ tự, đăng xuất/đổi người và cấp quyền duyệt mà không mở rộng phạm vi công việc. Chromium 1440px/390px, kiểm tra không tràn ngang, không có thanh chân trang thứ hai, không lỗi JavaScript.

Số đo trước/sau từng bước: [TRANG-CHU-HIEU-NANG.md](TRANG-CHU-HIEU-NANG.md). CI dùng đúng toàn bộ glob của `npm test`, chia 4 shard, concurrency 2; không bỏ/giảm test. Không có migration hoặc thay đổi quyền CSDL/Storage trong tính năng này.
