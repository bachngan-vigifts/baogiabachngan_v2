# Trang NCC – đặc tả

Phần **dữ liệu và logic đã xong và có test** (module `suppliers`). Phần **giao diện React chưa dựng** – chờ khung giao diện (Giai đoạn 6).
Đặc tả này là đầu vào để dựng nhanh: mỗi nút trên màn hình lấy từ `nextActions()`, mỗi form kiểm tra bằng các hàm `validate*`, nên giao diện và máy chủ không thể lệch nhau.

## Hai màn hình

### 1. Cổng NCC – `/supplier` (khu vực `supplier-portal`)
Ai vào: **tài khoản NCC** (chỉ thấy đơn của NCC mình) và **Manager** (thấy tất cả). Nhân viên thường bị chuyển về `/`; họ xem đơn NCC ở màn hình nội bộ "Hàng sắp về" nhưng **bị ẩn giá**. Tài khoản NCC không vào được trang nào khác (`pageRedirect`).

- **Danh sách đơn**: số phiếu, số báo giá, NCC (chỉ Manager), ngày về dự kiến, huy hiệu giai đoạn (`orderStage`), cờ *đã yêu cầu cọc / đã nhận cọc / sẵn sàng giao*, tổng tiền (ẩn với nhân viên). Bộ lọc theo giai đoạn.
- **Chi tiết đơn**: bảng dòng hàng (mã, tên, SL, đơn giá, chiết khấu, ngày hẹn, ghi chú NCC), khối tiền (`computeOrderTotals`: tạm tính, VAT, tổng, cọc theo %, đã trả, còn lại), file bản ký, lịch sử đổi ngày hẹn/chiết khấu so với đơn gốc.
- **Nút** = `nextActions(actor, order)`. Bảng đầy đủ: [`NCC-ACTIONS.md`](NCC-ACTIONS.md) (tự sinh).

### 2. Quản lý NCC – `#/suppliers` (khu vực `ncc-admin`, chỉ Manager) ✅ đã làm (đợt 1)
API: `src/modules/suppliers/api/directory-routes.ts` (`GET/POST /suppliers`, `GET/PUT /suppliers/:id`, `PUT /suppliers/:id/accounts`, `GET /supplier-account-candidates`). Giao diện: `trial-ui/suppliers.js` (menu Quản trị → Nhà cung cấp). Sửa NCC có khoá lạc quan `updatedAt` (409 khi người khác vừa sửa); mọi thao tác ghi vào `audit_logs` tự động.

Nơi sửa **mọi thứ về NCC mà trước đây phải sửa code**:

| Mục | Bảng | Ghi chú |
|---|---|---|
| Danh sách / thêm / sửa NCC | `suppliers` | `cleanSupplierInput`; trùng tên (bỏ dấu, hoa/thường, "đ"="d") bị chặn bằng `name_key`. **Không xoá** NCC đã có đơn – chuyển *Ngừng hoạt động*. |
| Email nhận đơn và CC | `supplier_contacts` | `cleanContacts`; điền sẵn khi duyệt đơn (`defaultRecipients`). Tối đa 20 CC. |
| Tài khoản đăng nhập của NCC | `supplier_accounts` | `planAccountLink`: chỉ gắn tài khoản chức vụ NCC đang hoạt động; mỗi tài khoản thuộc đúng một NCC. **Đây là nơi quyết định ai thấy đơn của NCC nào** (thay cho so email và hai email viết cứng của bản cũ). |

## Quyền xem đơn
| Người dùng | Thấy | Giá/tiền |
|---|---|---|
| Manager | mọi đơn NCC đã duyệt | đủ |
| Nhân viên | mọi đơn NCC đã duyệt | **ẩn** (`hidePrices`) |
| NCC | chỉ đơn có `supplier_id` = NCC của tài khoản | đủ |
| NCC chưa gắn vào nhà cung cấp | không gì cả | – |
| Tài khoản bị khoá | không gì cả | – |

Một câu SQL duy nhất (`portalOrderScope`) dùng cho danh sách, chi tiết và tải file để không bao giờ lệch với `orderVisibility`.

## API đề xuất (chưa cài – gắn vào router ở Giai đoạn 2/8)
Mọi route khai báo `Area`; cổng kiểm tra Area đặt **trước** mọi route.

| Area | Phương thức & đường dẫn | Hành động / hàm kiểm tra |
|---|---|---|
| self | `GET /me`, `POST /logout`, `POST /password` | – |
| supplier-portal | `GET /supplier-portal/orders` | `portalOrderScope`, `computeOrderTotals`, `hidePrices` |
| supplier-portal | `GET /supplier-portal/orders/:id/signature-file` | `orderVisibility` ≠ none |
| supplier-portal | `POST …/:id/internal-order` | `set_internal_number` · `cleanInternalOrderNumber` |
| supplier-portal | `POST …/:id/signature-upload` · `signature-delete` | `upload_signature` / `delete_signature` · `validateSignatureUpload` |
| supplier-portal | `POST …/:id/confirm` | `confirm` · `validateConfirmation` |
| supplier-portal | `POST …/:id/deposit-request` | `request_deposit` · `validateDepositRequest` |
| supplier-portal | `POST …/:id/delivery-ready` | `mark/unmark_delivery_ready` · `validateDeliveryReady` |
| supplier-portal | `GET /supplier-stock-requests`, `POST …/:id/respond` | xin hàng (tài khoản NCC trả lời) |
| ncc-admin | `POST /supplier-orders/:id/approve` | `approve` · `validateApproval` |
| ncc-admin | `POST /supplier-portal/orders/:id/pay-deposit` | `pay_deposit` · `validatePaidAmount` |
| ncc-admin | `POST /incoming-stock/:id/receive` | `receive` |
| ncc-admin | `GET/POST/PUT /suppliers`, `…/:id/contacts`, `…/:id/accounts` | `canManageSuppliers` · `cleanSupplierInput` · `cleanContacts` · `planAccountLink` |

Mỗi thao tác ghi: kiểm `checkAction` → kiểm dữ liệu → ghi trong **một giao dịch D1** (có cột `updated_at` làm khoá lạc quan, người ghi sau nhận 409) → ghi `audit_logs`.

## So với bản cũ
Giữ nguyên: mọi điều kiện cho phép/từ chối, mã lỗi và thông báo, mọi công thức tiền (đối chiếu trực tiếp với code cũ, xem `tests/legacy/`).
Khác có chủ đích:

1. **Ai thấy đơn của NCC nào** dựa trên `supplier_accounts` thay vì so email; hai email nội bộ viết cứng nay là dữ liệu.
2. **Ngày không tồn tại (31/02) bị từ chối** (bản cũ nhận vì `Date.parse` cuốn sang tháng sau).
3. **Tên mã hàng có trong danh sách đổi ngày/chiết khấu** (bản cũ ghi tên rỗng vì `stockRows` không lưu tên).
4. **Ba luật siết chặt** (mặc định bật, mỗi luật tắt được bằng một cờ trong `Rules`):
   - sau khi nhập kho: NCC không còn tải/xoá bản ký, xác nhận, yêu cầu cọc, báo giao (vẫn sửa được số phiếu nội bộ; Manager vẫn ghi nhận cọc);
   - đã xác nhận thì không xoá **hoặc thay** bản ký;
   - không nhập kho đơn NCC chưa duyệt.
5. Luật thứ tư `depositRequiresConfirmation` (phải xác nhận trước khi yêu cầu cọc) **tắt mặc định**, vì bản cũ cho phép và chưa rõ có chủ đích.
