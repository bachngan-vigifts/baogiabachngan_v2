# Phân quyền theo chức vụ, phòng ban

Trang **Quản trị › Phân quyền** (`#/permissions`, `trial-ui/permissions.js`). Người dùng được:

- Manager;
- chức vụ được cấp quyền **"Quản lý phân quyền"**.

## Mô hình

- **Phòng ban** (`staff_departments`): Ban giám đốc, Kinh doanh, Kho, Kế toán… Manager thêm / đổi tên / xoá. Chỉ xoá được phòng ban không còn chức vụ nào.
- **Chức vụ** (`staff_positions`): mỗi chức vụ thuộc một phòng ban (`department_id`). Mỗi chức vụ có:
  - **danh sách quyền** (`staff_position_permissions`);
  - **phạm vi dữ liệu** (`data_scope`).
- **Nhân viên** giữ một chức vụ. Gán chức vụ cho nhân viên ở trang Nhân viên.
- **Chức vụ hệ thống:**
  - Manager luôn có mọi quyền và không sửa được ở trang này, nên không ai tự khoá được Manager.
  - NCC và Khách hàng dùng trang riêng, không nằm trong bảng.
- **Chức vụ có sẵn** (Sale, Sale Admin, NVBH ML, NVBH LOCK, Kho, Kế toán): đổi tên và đổi quyền được, nhưng không xoá được.
- **Chức vụ tự thêm:**
  - Khi tạo có thể chép quyền và phạm vi từ một chức vụ khác.
  - Tạo mà không chép thì chức vụ không có quyền nào và phạm vi là "Chỉ của mình".
  - Chỉ xoá được khi không còn nhân viên giữ.
- **Nhật ký** (`staff_permission_log`) ghi mọi thay đổi: ai sửa, lúc nào, cấp / bỏ quyền gì.

## Danh mục quyền (`src/modules/staff/domain/permissions.ts`)

| Nhóm | Quyền | Mặc định |
|---|---|---|
| Trang được vào | Báo giá, Đơn đặt hàng, HĐKT, Công nợ, Khách hàng, Chăm sóc KH, Khách hỏi tồn, Tổng quan doanh số, Sơ đồ quy trình | Sale, Sale Admin, NVBH ML, NVBH LOCK, Kế toán |
| Trang được vào | Lịch giao hàng, Đơn mua NCC | Mọi chức vụ (cả Kho) |
| Kho | Phiếu đóng gói (xem tất cả, xác nhận đóng xong), Tra tồn, Nhận hàng NCC | Kho |
| Kho | Sổ kho – xem; Sổ kho – chốt tồn / phiếu điều chỉnh | Không ai (chỉ Manager) |
| Duyệt / tài chính | Duyệt báo giá, Duyệt giá đơn mua NCC | Không ai (chỉ Manager) |
| Duyệt / tài chính | Xem giá mua NCC, Ghi thanh toán NCC, Danh bạ NCC | Kế toán |
| Quản trị | Quản lý phân quyền | Không ai (chỉ Manager) |

Một số mục không nằm trong bảng:

- **Luôn có:** Công việc, Sản phẩm, Tin nhắn.
- **Chỉ Manager:** Nhân viên, Bảng lương, quản trị hệ thống.

**Phạm vi dữ liệu** áp cho báo giá, đơn, khách, chăm sóc và doanh số:

- **Chỉ của mình**;
- **Cùng chức vụ** (mặc định, đúng như cách chạy trước đây);
- **Cả phòng ban** (mọi chức vụ cùng phòng);
- **Toàn công ty (chỉ xem)** (mặc định của Sale Admin; không mở quyền sửa / duyệt).

## Hiệu lực

- **Máy chủ:** mỗi yêu cầu đọc quyền của chức vụ cùng lúc với phiên đăng nhập (`auth-repo.findSessionMember`), nên đổi quyền có hiệu lực ngay ở lần bấm kế tiếp.
- **Quyền trang** được chốt tại `authorizeRoute` (`routePermission`): API của trang chưa được cấp trả 403.
  - Ô chọn khách ở báo giá / đơn / chăm sóc vẫn dùng được khi tắt trang Khách hàng.
- **Quyền thao tác** được kiểm tra bên trong route bằng `can(member, key)`:
  - duyệt báo giá;
  - đơn mua NCC: duyệt, giá, nhận hàng, thanh toán;
  - Danh bạ NCC;
  - sổ kho;
  - phiếu đóng gói.
- **Giao diện:**
  - Menu chỉ hiện trang được cấp.
  - Mở link trang không được cấp thì quay về trang mở đầu: Trang kho / Báo giá / Công việc.
- **Quy tắc vẫn cố định theo chức vụ** (đợt sau):
  - Kế toán xem mọi đơn hàng / công nợ.
  - Kho giao hàng: không huỷ được chuyến, bắt buộc chụp ảnh khi đã giao.
  - Kho có trang chủ riêng (Trang kho) và thanh điều hướng dưới riêng.

## Migration

- `0065_staff_permissions.sql`: tạo bảng, thêm 4 phòng ban, xếp chức vụ vào phòng ban, ghi quyền mặc định. Kết quả là chạy xong mọi người giữ nguyên quyền như cũ.
- `0066_supabase_access_staff_permissions.sql`: thu quyền truy cập trực tiếp (Data API) của 3 bảng mới.
