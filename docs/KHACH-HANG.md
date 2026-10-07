# Khách hàng: danh sách, thêm mới, trang chi tiết

## Giao diện
- **Danh sách** (`#/customers`):
  - Nút **＋ xanh lá** ở đầu trang để thêm khách hàng. Nút hiện cả trên máy tính và điện thoại.
  - Lưu xong thì mở luôn trang chi tiết của khách mới.
  - Có cột **Phụ trách** (kèm số người được chia sẻ) và ô lọc **Khách của tôi** (`?mine=1`).
  - Bấm vào dòng hoặc tên khách để mở trang chi tiết.
- **Trang chi tiết** (`#/customers/<id>`, file `trial-ui/customer-detail.js`):
  - **Đầu trang:** tên khách, nhãn *Sapo* hoặc *Tạo trên web*, nút **Sửa thông tin** và **＋ Báo giá**.
  - **Thống kê:** doanh số (đơn đã xác nhận), đã thu, còn nợ (kèm quá hạn), lần mua gần nhất.
  - **Hồ sơ:**
    - Thông tin: mã KH, MST, liên hệ chính, điện thoại, email, địa chỉ.
    - Nhân viên: phụ trách và được chia sẻ, kèm nút *Phân công / chia sẻ*.
    - Người liên hệ: thêm, sửa, xoá; đánh dấu liên hệ chính.
  - **Các mục (tab):** Đơn hàng · Báo giá · HĐKT · Giao dịch (phiếu thu) · Công nợ · Lịch sử mua · Giao hàng · Hỏi tồn · Tài khoản.
  - Thêm một mục mới chỉ cần thêm một phần tử vào mảng `TABS`: key, nhãn, hàm đếm, hàm vẽ.

## Dữ liệu (chuẩn hoá, mỗi thứ một bảng)
| Bảng | Nội dung |
|---|---|
| `sapo_customers` | Hồ sơ khách. Khách từ Sapo có id số; khách tạo trên web có id UUID và Sapo không ghi đè. Liên hệ chính ở cột `contact/phone/email`. |
| `customer_staff` | Nhân viên gắn với khách. Khoá chính `(customer_id, member_id)`. `role` = `owner` (phụ trách, tối đa 1 người, có unique index riêng) hoặc `shared` (được chia sẻ). |
| `customer_contacts` | Người liên hệ bổ sung (kế toán, mua hàng, người nhận hàng…): họ tên, chức vụ, điện thoại, email, ghi chú, `is_primary`. |
| `customer_accounts` | Tài khoản trang khách hàng (đã có). |
| `sales_orders`, `sales_contracts`, `customer_payments`, `deliveries`, `payment_schedules`, `staff_quotations` (`data.customerId`), `customer_stock_requests` | Dữ liệu giao dịch, gom theo `customer_id`. Không chép sang bảng khác. |

- Hằng số vai trò và giới hạn nằm ở `src/modules/customers/domain/customer-config.ts`.
- Giới hạn số dòng của trang chi tiết nằm ở `src/modules/customer-hub/domain/overview.ts`.
- Migration: `0022_customer_staff_contacts.sql`, phân quyền ở `0023_supabase_access_customer_staff_contacts.sql`.
- Migration 0022 gán sẵn người phụ trách cho khách đã có, theo thứ tự ưu tiên:
  1. người phụ trách đơn gần nhất của khách;
  2. nếu khách chưa có đơn, người phụ trách tài khoản trang khách hàng.
- Khách chưa có người phụ trách: khi tạo đơn đầu tiên, người phụ trách đơn tự thành người phụ trách khách.

## Quyền
- **Thêm khách:** người tạo thành người phụ trách. Manager chọn được người khác qua `ownerId`.
- **Xem toàn bộ** báo giá, đơn, HĐKT, công nợ của khách: Manager, người phụ trách, người được chia sẻ.
  - Phạm vi đơn (`orderScopeFor` trong `sales`) có thêm điều kiện "khách mình phụ trách / được chia sẻ". Vì vậy người được chia sẻ mở được trang chi tiết đơn, HĐKT, lịch giao và công nợ của khách đó.
  - Báo giá vẫn theo quyền báo giá cũ khi mở chi tiết. Trang khách chỉ liệt kê báo giá của khách cho người có quyền xem toàn bộ.
- **Nhân viên khác:** trên trang chi tiết chỉ thấy phần mình phụ trách hoặc tự tạo.
- **Đổi người phụ trách:** chỉ Manager. **Đổi danh sách chia sẻ:** Manager hoặc người phụ trách.
- **Người liên hệ:** mọi nhân viên kinh doanh đều thêm, sửa được.

## API
| Route | Việc |
|---|---|
| `GET /customers?q=&mine=1` | Danh sách, mỗi dòng kèm `owner` và `sharedCount`. |
| `POST /customers` / `PUT /customers/:id` | Thêm / sửa hồ sơ. |
| `GET /customers/:id` | Hồ sơ, người phụ trách, người được chia sẻ, người liên hệ, quyền của người xem. |
| `PUT /customers/:id/staff` | `{ ownerId?, sharedIds? }`. |
| `POST/PUT/DELETE /customers/:id/contacts[/:contactId]` | Người liên hệ. |
| `GET /customers/:id/overview` | Trang chi tiết, gom trong một lượt (module `customer-hub`): hồ sơ, `stats`, `quotes`, `orders` (kèm công nợ), `contracts`, `payments`, `deliveries`, `purchases`, `stockRequests`, `accounts`. |

Module `customer-hub` chỉ đọc. Module này được import `staff`, `customers`, `quotes`, `sales`, `portal` (xem `tests/architecture.test.ts`).

## Duyệt khách hàng mới
- Nhân viên thêm khách → `approval_status = 'pending'` ("Chờ duyệt"). Manager thêm → `approved` ngay.
- Khách chờ duyệt: không có trong ô chọn khách khi lập báo giá (`GET /customers?usable=1`), không lập đơn được và không cấp tài khoản khách được (409 `CUSTOMER_PENDING`).
- `POST /customers/:id/approve`: chỉ Manager. `DELETE /customers/:id`: từ chối / xoá khách **đang chờ duyệt** (Manager hoặc người tạo).
- `GET /customers?status=pending` lọc khách chờ duyệt; mọi phản hồi danh sách kèm `pendingCount`.
- Khách đồng bộ từ Sapo luôn là `approved`. Cột: `approval_status`, `created_by`, `approved_by`, `approved_at` (migration `0024_approvals_member_delete.sql`).
