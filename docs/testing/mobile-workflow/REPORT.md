# Mobile workflow audit — baseline

Đo bằng Chromium 390/1280, CRM router thật và PGlite local; không gọi production. Ảnh của 30 trang/chi tiết nằm trong `before/`, dữ liệu đo trong `before/audit.json`. `staff` dùng route hiện hành `#/members`.

## Lỗi ghi nhận trước sửa

- Thanh dưới có 27 mục được cấp quyền, cuộn ngang; 4 mục chính không cố định.
- Trang chủ chiếm một hàng riêng; HĐKT lặp hàng Trang chủ bên trong sheet.
- HĐKT di chuyển `#view-order` khỏi main vào dialog ở cả mobile/1280. Mobile cần trang đầy đủ không đổi chủ DOM; desktop giữ bố cục cũ.
- Công việc có tab và select Chế độ xem; tab thứ ba là Việc nhóm, Cần duyệt không nằm trong ba tab đầu.
- Bộ lọc hiện tại chỉ đóng sheet khi Xem; thay đổi đã tải dữ liệu ngay. Xoá lọc cũng tác động ngay.
- Menu chung gom cả nút quan trọng; scan di chuyển controls ngay khi observer chạy, theo dõi style. POS chưa được loại trừ.
- Đơn giá sau CK của dòng báo giá bị ẩn sau Chi tiết ở trạng thái thu gọn.
- Kho/điều chỉnh/đồng bộ và tác vụ rủi ro vẫn đi vào menu dùng chung trên mobile.

## Đo đường mở thao tác hiện tại

Không tính nhập chữ; số này đo tới điều khiển thao tác trên dữ liệu mẫu, chưa cộng bước nhập/chọn dữ liệu hay xác nhận nghiệp vụ. Không coi đây là số chạm hoàn thành toàn bộ nghiệp vụ.

| Thao tác | 390px |
|---|---:|
| Mở tạo báo giá | 1 (còn dialog trung gian) |
| Chạm sửa số lượng dòng | 1 |
| Gửi duyệt | N/A với Manager mẫu; cần kiểm NVBH riêng |
| Mở HĐKT và nút hồ sơ | 2 |
| Hoàn thành công việc | 1 |
| Mở lọc và Xem | 2, nhưng lọc đã áp dụng trước đó |
| Gọi khách | 1 |
| Mở thêm chăm sóc | 1 |
| Mở xuất Excel sản phẩm | 2 |
| Đóng chi tiết HĐKT | 1 |

## Từng trang baseline

| Trang | 390px | 1280px |
|---|---|---|
| quotes | [Ảnh](before/quotes-390.png) | [Ảnh](before/quotes-1280.png) |
| quote-new | [Ảnh](before/quote-new-390.png) | [Ảnh](before/quote-new-1280.png) |
| contracts | [Ảnh](before/contracts-390.png) | [Ảnh](before/contracts-1280.png) |
| contract-detail | [Ảnh](before/contract-detail-390.png) | [Ảnh](before/contract-detail-1280.png) |
| tasks | [Ảnh](before/tasks-390.png) | [Ảnh](before/tasks-1280.png) |
| orders | [Ảnh](before/orders-390.png) | [Ảnh](before/orders-1280.png) |
| order-detail | [Ảnh](before/order-detail-390.png) | [Ảnh](before/order-detail-1280.png) |
| customers | [Ảnh](before/customers-390.png) | [Ảnh](before/customers-1280.png) |
| customer-detail | [Ảnh](before/customer-detail-390.png) | [Ảnh](before/customer-detail-1280.png) |
| care | [Ảnh](before/care-390.png) | [Ảnh](before/care-1280.png) |
| pos | [Ảnh](before/pos-390.png) | [Ảnh](before/pos-1280.png) |
| deliveries | [Ảnh](before/deliveries-390.png) | [Ảnh](before/deliveries-1280.png) |
| packing | [Ảnh](before/packing-390.png) | [Ảnh](before/packing-1280.png) |
| receivables | [Ảnh](before/receivables-390.png) | [Ảnh](before/receivables-1280.png) |
| cash | [Ảnh](before/cash-390.png) | [Ảnh](before/cash-1280.png) |
| cashbook | [Ảnh](before/cashbook-390.png) | [Ảnh](before/cashbook-1280.png) |
| purchases | [Ảnh](before/purchases-390.png) | [Ảnh](before/purchases-1280.png) |
| receiving | [Ảnh](before/receiving-390.png) | [Ảnh](before/receiving-1280.png) |
| suppliers | [Ảnh](before/suppliers-390.png) | [Ảnh](before/suppliers-1280.png) |
| incoming | [Ảnh](before/incoming-390.png) | [Ảnh](before/incoming-1280.png) |
| kho | [Ảnh](before/kho-390.png) | [Ảnh](before/kho-1280.png) |
| stock-moves | [Ảnh](before/stock-moves-390.png) | [Ảnh](before/stock-moves-1280.png) |
| inventory | [Ảnh](before/inventory-390.png) | [Ảnh](before/inventory-1280.png) |
| transfers | [Ảnh](before/transfers-390.png) | [Ảnh](before/transfers-1280.png) |
| products | [Ảnh](before/products-390.png) | [Ảnh](before/products-1280.png) |
| staff | [Ảnh](before/staff-390.png) | [Ảnh](before/staff-1280.png) |
| payroll | [Ảnh](before/payroll-390.png) | [Ảnh](before/payroll-1280.png) |
| permissions | [Ảnh](before/permissions-390.png) | [Ảnh](before/permissions-1280.png) |
| flow | [Ảnh](before/flow-390.png) | [Ảnh](before/flow-1280.png) |
| dashboard | [Ảnh](before/dashboard-390.png) | [Ảnh](before/dashboard-1280.png) |
