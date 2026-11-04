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
| Trang được vào | Đơn đặt hàng, HĐKT, Công nợ, Khách hàng, Tổng quan doanh số, Sơ đồ quy trình | Sale, Sale Admin, NVBH ML, NVBH LOCK, Kế toán |
| Trang được vào | Báo giá, Chăm sóc KH, Khách hỏi tồn | Sale, Sale Admin, NVBH ML, NVBH LOCK (Kế toán bỏ từ migration 0071) |
| Trang được vào | Lịch giao hàng, Đơn mua NCC | Mọi chức vụ (cả Kho) |
| Kho | Phiếu đóng gói (xem tất cả, xác nhận đóng xong), Tra tồn | Kho, Sale Admin |
| Kho | Nhận hàng NCC về kho | Kho, Sale Admin, Kế toán |
| Mua hàng NCC | Xin hàng trước – xem danh sách phiếu | Mọi chức vụ vào được Đơn mua NCC |
| Mua hàng NCC | Xin hàng trước – lập, sửa, gửi NCC, tải file; Huỷ đơn mua đã duyệt | Sale Admin |
| Mua hàng NCC | Xác nhận thay NCC | Sale Admin, Kế toán |
| Kho | Sổ kho – xem; Sổ kho – chốt tồn / phiếu điều chỉnh | Không ai (chỉ Manager) |
| Tài chính NCC | Xem giá mua NCC, Ghi thanh toán NCC, Danh bạ NCC | Kế toán, Sale Admin |
| Kế toán | Sổ thu / chi; Huỷ phiếu thu ghi nhầm; Doanh số toàn công ty | Kế toán (migration 0071) |
| Quản trị | Quản lý phân quyền | Không ai (chỉ Manager) |

**Nhóm nhận việc theo quyền:** việc giao cho nhóm Kế toán cũng đến người có quyền "Ghi thanh toán / lịch trả NCC"; nhóm Kho cũng đến người có quyền "Nhận hàng NCC" (thông báo "Kho: yêu cầu đóng gói" đến người có quyền "Phiếu đóng gói"). VD Sale Admin nhận việc "Xuất hoá đơn", "Thanh toán NCC".

Một số mục không nằm trong bảng:

- **Luôn có:** Công việc, Sản phẩm, Tin nhắn.
- **Chỉ Manager:** Nhân viên, Bảng lương, quản trị hệ thống.

**Phạm vi dữ liệu** áp cho báo giá, đơn, khách, chăm sóc và doanh số:

- **Chỉ của mình**;
- **Cùng chức vụ** (mặc định, đúng như cách chạy trước đây);
- **Cả phòng ban** (mọi chức vụ cùng phòng);
- **Toàn công ty (chỉ xem)** (mặc định của Sale Admin; không mở quyền sửa / duyệt).

## Phê duyệt: cờ "Được duyệt" từng nhân viên

Các thao tác phê duyệt chỉ do **Manager** hoặc **nhân viên được Manager bật cờ "Được duyệt"** (`staff_members.can_approve`, migration 0067):

- **Ngoại lệ POS đã chốt:** khách tạo tại POS dùng ngay, nhân viên tự nhập chiết khấu hợp lệ tới 100%, bill 0 đồng được phép; các thao tác này không phát sinh yêu cầu duyệt. Phiếu thu/chi thủ công từ ngưỡng cấu hình vẫn phải duyệt.
- **Ai bật / tắt cờ:** chỉ Manager, ở trang **Nhân viên** (ô "Được duyệt" cạnh chức vụ).
  - API: `PUT /admin/members/:id/approver`, khu vực `admin`; câu UPDATE kiểm lại người thao tác là Manager.
  - Mỗi lần bật / tắt được ghi vào Nhật ký phân quyền.
- **Không nằm trong bảng quyền theo chức vụ:** người có "Quản lý phân quyền" không tự cấp duyệt được.
- **Hàm kiểm tra:** `canApprove(member)` trong `src/modules/staff/domain/permissions.ts`.
- **Endpoint đã kiểm quyền ở máy chủ:**

| Phê duyệt | Endpoint |
|---|---|
| Báo giá (cả báo giá khách gửi từ trang khách hàng) | `POST /quotes/:id/approve`; ô `canApprove` của `GET /quotes/:id` |
| Trả lại báo giá kèm lý do (về nháp, báo người lập) | `POST /quotes/:id/reject` – chỉ báo giá đang chờ duyệt, lý do ≥ 3 ký tự |
| Khách hàng mới | `POST /customers/:id/approve`; từ chối = `DELETE /customers/:id` (người được duyệt, hoặc người tạo xoá khách của mình) |
| Sản phẩm mới | `POST /products/:sku/approve`; từ chối = `DELETE /products/:sku`; `GET /product-approvals` |
| Đơn hàng / HĐKT | `PUT /orders/:id/status` với `confirmed` |
| Đơn mua NCC (duyệt giá) | `POST /purchase-orders/:id/approve` (`checkPurchase('approve')`) |
| Phiếu thu/chi thủ công Sổ quỹ | `POST /cash/entries/:id/approve`; cần `page.cash` hoặc `pos.sell`; Manager được tự duyệt phiếu của mình; nhân viên được chỉ định không được tự duyệt. Người được chỉ định chỉ xem thêm phiếu thủ công chờ duyệt và ảnh kèm theo, không tự có quyền xem mọi ca/thu bán hàng/tra soát. |
| Hộp "Cần duyệt" | `GET /approvals` (báo giá, đơn, HĐKT, **đơn mua NCC đã gửi duyệt**, khách hàng, sản phẩm) |
| Nút duyệt nhanh ở Sơ đồ quy trình | `GET /flow` (chỉ trả thao tác `approve-*` cho người được duyệt) |

- **Người được duyệt còn thấy thêm:**
  - báo giá đang chờ duyệt;
  - đơn / HĐKT đã gửi duyệt;
  - mọi khách / sản phẩm chờ duyệt;
  - giá mua của đơn mua NCC (phải nhập giá khi duyệt).
- **Thông báo "chờ duyệt"** (báo giá, đơn, HĐKT) gửi cho Manager và người được duyệt (`notifyMany(env, 'approvers')`).
- **Giữ nguyên chỉ Manager** (không phải phê duyệt, hoặc ngoài phạm vi):
  - Tự duyệt khi Manager tự tạo (báo giá, khách, sản phẩm, đơn mua).
  - Nhập đơn mua từ file.
  - Ghi nhận NCC xác nhận thay NCC.
  - Sửa / huỷ chứng từ đã duyệt.
  - Chốt lương `POST /hr/payroll/:month/confirm` (thuộc logic lương, không đụng).
  - Việc tự sinh "Duyệt đơn mua" vẫn giao Manager.

## Sale Admin (tạm thời, yêu cầu 17/10/2026)

- **Quyền:** có quyền của **Sale + Kế toán + Kho** trong bảng quyền: các trang của Sale; xem giá / ghi thanh toán / danh bạ NCC; phiếu đóng gói, tra tồn, nhận hàng NCC.
  - Không có phê duyệt, trừ khi Manager bật cờ "Được duyệt".
- **Xem toàn công ty** (phạm vi "Toàn công ty (chỉ xem)", `seesAllAsSaleAdmin`): CHỈ ở báo giá, khách hàng, đơn hàng, HĐKT, kèm giao hàng / công nợ của đơn.
  - Khách hỏi tồn, chăm sóc khách, doanh số theo phạm vi thường: của mình / cùng chức vụ.
  - Đơn mua NCC xem tất cả nhờ quyền Kế toán.
- **Chưa chốt:** quyền tạo / sửa dữ liệu của người khác.
  - Hiện **không sửa** được báo giá / khách của người khác.
  - Nhưng **thao tác được trên đơn hàng / HĐKT** của người khác như trước 17/10 (lập phiếu đóng gói, lịch giao, thu tiền…), vì phạm vi đơn dùng chung cho xem và sửa.
  - Quyền trả lời khách hỏi tồn của người khác (có từ 15/10) đã bỏ cùng với phạm vi xem.

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

### Quầy và két của nhân viên cửa hàng

NVBH/CHT Lock giới hạn quầy và két Lock; NVBH/CHT Minh Long giới hạn quầy và két Minh Long. Quyền bán hàng/cấu hình/duyệt được cấp thêm không mở rộng cửa hàng. Manager vẫn truy cập cả hai. API kiểm phạm vi trước khi đọc/ghi, không chỉ ẩn danh sách trên giao diện; xem POS.md và CASH.md.

## Kho bán theo chức vụ (18/10/2026)
- Bảng kho ↔ chức vụ được bán + cờ **kho riêng** ở cuối trang Phân quyền (`GET/PUT /warehouse-sellers`, cần quyền "Quản lý phân quyền"). Chi tiết: docs/SO-KHO.md.
- Quyền mới **`stock.transfer`** – "Điều chuyển kho – xác nhận đã chuyển" (mặc định Kho, Sale Admin). Duyệt phiếu điều chuyển: Manager / người được duyệt (`canApprove`).

## Quyền mua hàng NCC lên trang Phân quyền (11/11/2026, migration 20261111090000)

- Bốn quyền trước đây gắn cứng theo chức vụ nay bật / tắt được: **`purchases.early-view`**, **`purchases.early-request`**, **`purchases.confirm`**, **`purchases.cancel-approved`**.
- Kế toán nhận hàng NCC theo đúng công tắc "Nhận hàng NCC về kho" (migration bật sẵn cho Kế toán). Kế toán không vào nhóm việc Kho dù có quyền này.
- Mặc định giữ y như trước; Xoá / huỷ / tách phiếu xin hàng trước, xác nhận thay NCC ở phiếu xin hàng trước vẫn chỉ Manager.
