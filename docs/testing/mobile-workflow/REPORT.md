# Mobile workflow audit

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


## Kết quả và diff theo trang

Chỉ trình bày/thao tác ở `max-width: 850px`. Không sửa `src/`, API, migration, schema, quyền máy chủ, công thức giá/thuế/CK, tồn kho, Sapo, GHN hay cron; không thêm dependency. Tên phụ trách dùng **tên in trên báo giá** theo xác nhận của chủ repo. Công việc giữ **7 ngày tới** theo xác nhận của chủ repo.

| Phạm vi | Thay đổi mobile |
|---|---|
| Toàn cục | 4 mục chính được cấp quyền + Thêm; Thêm mở lưới sidebar và Trang chủ. Không còn hàng Trang chủ riêng hoặc cuộn 27 mục. Tài khoản thiếu quyền có ít mục hơn, không cấp quyền mới. |
| Menu/thao tác | Chỉ nút phụ vào menu; giữ Lưu/Gửi/Xác nhận, điều khiển nguồn/số lượng. Tác vụ rủi ro ngoài chi tiết bị ẩn; trong dialog/trang chi tiết giữ luồng xác nhận hiện có. Kho/sản phẩm chỉ xem. |
| Focus/observer | Không theo dõi style; scan không chuyển controls đang nhập. Nút phụ và bộ lọc ở vị trí cũ đến khi mở sheet, đóng trả lại. Không clone controls. POS loại khỏi scan/menu. |
| Bộ lọc | Một sheet cho bộ lọc bổ sung; thay đổi và Xóa chỉ là nháp đến Xem; đóng/Escape phục hồi. Tìm kiếm/chip nhanh ngoài sheet vẫn áp dụng ngay và có lời giải thích trong sheet. Khi nháp chưa áp dụng không hiển thị số kết quả cũ như dự báo mới. |
| Báo giá danh sách | Mã/khách/tiền/trạng thái; tên phụ trách bản in đọc từ API chi tiết hiện có, chỉ hàng gần viewport, tối đa 2 request đồng thời và cache theo người dùng/id/updatedAt. Không có request bổ sung ở desktop. |
| Báo giá mới/chi tiết | Một cột, bỏ bước trung gian tạo mới; dock Lưu & gửi duyệt. Lưu thất bại không gửi duyệt. Số lượng/giá sau CK/thành tiền luôn thấy; giá/CK/phí in vẫn sửa trực tiếp, phần mô tả dưới Chi tiết. Nháp thiết bị chỉ mời khôi phục một lần/tab-session, có Bỏ qua. |
| HĐKT | Mobile dùng trang đầy đủ; `#view-order` thuộc main. Thanh hồ sơ dán đáy + hàng ĐG/GH/Lịch sử. Desktop giữ sheet cũ. Không lặp view sau 5 lần refresh. |
| Công việc | 3 tab Của tôi/Tôi giao/Cần duyệt; bỏ select chế độ trùng; tài khoản không có quyền duyệt không được cấp thêm quyền. Lọc hạn một hàng, giữ 7 ngày tới. Chi tiết dùng checkbox hoàn thành thay nút hoàn thành thứ hai. |
| Đơn hàng | Hai vùng lọc vào một sheet; giữ trạng thái nhanh và chi tiết nghiệp vụ. |
| Khách hàng/Chăm sóc | 4 tab Tổng quan/Đơn/Công nợ/Chăm sóc; Gọi/Báo giá trực tiếp trên dòng theo quyền hiện có. Form chăm sóc một cột, không sửa nextAt/trạng thái chốt/rớt. |
| POS | Giữ layout/module hiện hành; không tạo menu/sheet toàn cục trong POS, không phủ thanh toán. |
| Giao/ĐG/Công nợ/Thu chi/Mua/Nhận/NCC/Hàng về | Các dòng thu gọn còn thông tin chính và Chi tiết mở phần còn lại; dòng có input/select và bảng phân bổ giữ nguyên. Nút xác nhận dùng handler và xác nhận hiện có, không chuyển vào menu phụ. |
| Kho/Sổ kho/Tồn/Điều chuyển/Sản phẩm | Tra cứu trên mobile; ẩn công cụ cập nhật, nhập danh mục, đồng bộ, chốt/điều chỉnh. Giữ dữ liệu tra cứu và bảng cuộn riêng. |
| Nhân sự/Lương/Phân quyền/Sơ đồ | Bảng cuộn trong khung, không biến cột thành menu. Sơ đồ chỉ xem mobile. Khung cấu hình kho không còn xuất hiện dưới trang khác trên mobile. |
| Dashboard | 4 KPI, Xem thêm/Thu gọn phần còn lại. Không đổi số liệu hay rút gọn số tiền ở chi tiết. |

## Kiểm thử

- Node **22.22.0** chạy toàn bộ globs của `npm test`: **1.155 ca, 1.124 pass, 31 skip, 0 fail**, 22 phút 43 giây. Skip có sẵn: 30 ca so sánh với repo legacy không có trong môi trường và 1 ca hai kết nối PostgreSQL thật không chạy được bằng PGlite một connection. Hai test policy mới được thêm sau khi suite bắt đầu nên chạy riêng: **2/2 pass**.
- `npm run typecheck`, `npm run ui:build` đạt. Các test liên quan chạy lại: device draft 4/4, quote mobile 6/6, trial UI/money parity 5/5; policy 2/2.
- Chromium + router thật/PGlite, không gọi production: 360/390/430/768/1280px. [Kết quả regression](regression.json). Giữ focus khi gõ/tải kết quả chăm sóc; filter không query đến Apply; đóng hủy nháp; 5 lần refresh HĐKT không nhân đôi; Back/Forward; rời form bẩn có xác nhận; POS không có menu toàn cục; mobile không có nút điều chỉnh tồn.
- NVBH: Lưu & gửi duyệt thực sự chuyển báo giá sang pending. Giả lập lưu trả 503 giữ trạng thái draft, không gửi duyệt.
- 30 trang x 5 kích thước: không tràn toàn trang trên 360/390/430/768. 1280 có 3 trường hợp tràn sẵn ở baseline (quotes/quote-new/staff do nội dung/bảng desktop); giữ nguyên theo yêu cầu không sửa desktop. [Audit 5 kích thước](viewports.json).
- Đối chiếu riêng desktop 1280 với cùng fixture và nguồn UI baseline: **27/30 ảnh khớp pixel**; tasks khác thứ tự việc tự sinh, cash khác thời điểm, customers khác trạng thái dữ liệu tải. Bố cục giữ nguyên; không dùng những khác biệt dữ liệu đó làm bằng chứng CSS thay đổi.
- Hai script kiểm thử mobile cũ chuyển thành entry point của regression mới; các kỳ vọng cũ về footer cuộn, di chuyển HĐKT, áp dụng lọc ngay và gom Lưu vào menu đã bị thay thế.

### Phạm vi bằng chứng

Ảnh dùng dữ liệu local giả lập; một số trang danh sách không có chứng từ mẫu nên chưa chứng minh mọi trạng thái nghiệp vụ trên từng trang. Không thử tạo giao dịch, thu/chi, nhận/xuất kho hoặc vận đơn production. Các handler nghiệp vụ không thay đổi. Kiểm tra 5 refresh là gọi lại router refresh hiện hành; không chờ 5 chu kỳ cron.

“Phiên” nháp thiết bị là phiên của tab (`sessionStorage`); tab mới là một phiên mới. Chọn nhanh/tìm ngoài sheet vẫn áp dụng ngay; chỉ bộ lọc bổ sung có bước Xem. Tải hồ sơ từ trang chi tiết cần thêm bước chọn tải trong dialog; đường ngắn hơn là nút hồ sơ trực tiếp ở danh sách. Không bỏ bước xác nhận nghiệp vụ để đạt số chạm thấp.

## Ảnh sau sửa

| Trang | 390px | 1280px |
|---|---|---|
| quotes | [Ảnh](after/quotes-390.png) | [Ảnh](after/quotes-1280.png) |
| quote-new | [Ảnh](after/quote-new-390.png) | [Ảnh](after/quote-new-1280.png) |
| contracts | [Ảnh](after/contracts-390.png) | [Ảnh](after/contracts-1280.png) |
| contract-detail | [Ảnh](after/contract-detail-390.png) | [Ảnh](after/contract-detail-1280.png) |
| tasks | [Ảnh](after/tasks-390.png) | [Ảnh](after/tasks-1280.png) |
| orders | [Ảnh](after/orders-390.png) | [Ảnh](after/orders-1280.png) |
| order-detail | [Ảnh](after/order-detail-390.png) | [Ảnh](after/order-detail-1280.png) |
| customers | [Ảnh](after/customers-390.png) | [Ảnh](after/customers-1280.png) |
| customer-detail | [Ảnh](after/customer-detail-390.png) | [Ảnh](after/customer-detail-1280.png) |
| care | [Ảnh](after/care-390.png) | [Ảnh](after/care-1280.png) |
| pos | [Ảnh](after/pos-390.png) | [Ảnh](after/pos-1280.png) |
| deliveries | [Ảnh](after/deliveries-390.png) | [Ảnh](after/deliveries-1280.png) |
| packing | [Ảnh](after/packing-390.png) | [Ảnh](after/packing-1280.png) |
| receivables | [Ảnh](after/receivables-390.png) | [Ảnh](after/receivables-1280.png) |
| cash | [Ảnh](after/cash-390.png) | [Ảnh](after/cash-1280.png) |
| cashbook | [Ảnh](after/cashbook-390.png) | [Ảnh](after/cashbook-1280.png) |
| purchases | [Ảnh](after/purchases-390.png) | [Ảnh](after/purchases-1280.png) |
| receiving | [Ảnh](after/receiving-390.png) | [Ảnh](after/receiving-1280.png) |
| suppliers | [Ảnh](after/suppliers-390.png) | [Ảnh](after/suppliers-1280.png) |
| incoming | [Ảnh](after/incoming-390.png) | [Ảnh](after/incoming-1280.png) |
| kho | [Ảnh](after/kho-390.png) | [Ảnh](after/kho-1280.png) |
| stock-moves | [Ảnh](after/stock-moves-390.png) | [Ảnh](after/stock-moves-1280.png) |
| inventory | [Ảnh](after/inventory-390.png) | [Ảnh](after/inventory-1280.png) |
| transfers | [Ảnh](after/transfers-390.png) | [Ảnh](after/transfers-1280.png) |
| products | [Ảnh](after/products-390.png) | [Ảnh](after/products-1280.png) |
| staff | [Ảnh](after/staff-390.png) | [Ảnh](after/staff-1280.png) |
| payroll | [Ảnh](after/payroll-390.png) | [Ảnh](after/payroll-1280.png) |
| permissions | [Ảnh](after/permissions-390.png) | [Ảnh](after/permissions-1280.png) |
| flow | [Ảnh](after/flow-390.png) | [Ảnh](after/flow-1280.png) |
| dashboard | [Ảnh](after/dashboard-390.png) | [Ảnh](after/dashboard-1280.png) |


## Đo 10 thao tác trước/sau ở 390px

Đo lại bằng cùng router/PGlite và fixture, NVBH cho báo giá; Manager cho phần còn lại. [Trace trước](taps-before.json), [trace sau](taps-after.json). ZIP/XLSX thực sự phát sinh download; gửi duyệt/hoàn thành được kiểm trạng thái qua API local; chăm sóc lưu xong đóng form.

**Số dưới đây là chạm điều hướng/nút hành động. Không bao gồm gõ, focus ô nhập, chọn khách/sản phẩm, chọn giá trị lọc, thao tác ứng dụng điện thoại ngoài CRM.** Tạo báo giá mẫu còn 2 chạm thêm dòng và các ô nhập; chăm sóc còn 1 chạm chọn khách và nhập nội dung. Vì vậy không tuyên bố toàn bộ công việc gồm nhập dữ liệu luôn hoàn tất trong 2 chạm.

| Thao tác / điểm bắt đầu | Trước | Sau | Kiểm tra |
|---|---:|---:|---|
| Tạo và gửi báo giá từ danh sách | 5 | 2 | NVBH; lưu và pending |
| Sửa số lượng khi đang ở dòng | 1 | 1 | Ô sửa được, lưu là bước riêng |
| Gửi duyệt từ editor có dữ liệu hợp lệ | 2 | 1 | Pending; lỗi lưu không submit |
| Mở hồ sơ trực tiếp từ danh sách HĐKT và tải bộ | 3 | 2 | ZIP tải thành công |
| Hoàn thành việc trên danh sách | 1 | 1 | Backend local status done |
| Mở lọc rồi Xem | 2 | 2 | Trước áp dụng ngay; sau chờ Apply |
| Gọi từ danh sách khách | 1 | 1 | Click tel; không thực hiện cuộc gọi |
| Thêm chăm sóc, bấm Lưu | 2 | 2 | Không tính nhập/chọn dữ liệu |
| Xuất Excel từ Sản phẩm | 3 | 2 | XLSX tải thành công, dùng cột mặc định |
| Đóng chi tiết HĐKT về danh sách | 1 | 1 | Hash trở về contracts |

Nếu mở HĐKT bằng cách bấm dòng rồi mở hồ sơ rồi tải thì cần 3 chạm; đường 2 chạm là nút hồ sơ ngay trên danh sách. Các nghiệp vụ có bước xác nhận không bị bỏ xác nhận để rút số chạm.
