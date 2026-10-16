# Trang NCC – đặc tả

Phần **dữ liệu và logic đã xong và có test** (module `suppliers`). Phần **giao diện React chưa dựng** – chờ khung giao diện (Giai đoạn 6).
Đặc tả này là đầu vào để dựng nhanh: mỗi nút trên màn hình lấy từ `nextActions()`, mỗi form kiểm tra bằng các hàm `validate*`, nên giao diện và máy chủ không thể lệch nhau.

## Hai màn hình

### 1. Cổng NCC – `/supplier` (khu vực `supplier-portal`)
Ai vào: **tài khoản NCC** (chỉ thấy đơn của NCC mình) và **Manager** (thấy tất cả). Nhân viên thường bị chuyển về `/`; họ xem đơn NCC ở màn hình nội bộ "Hàng sắp về" nhưng **bị ẩn giá**. Tài khoản NCC không vào được trang nào khác (`pageRedirect`).

- **Danh sách đơn**: số phiếu, số báo giá, NCC (chỉ Manager), ngày về dự kiến, huy hiệu giai đoạn (`orderStage`), cờ *đã yêu cầu cọc / đã nhận cọc / sẵn sàng giao*, tổng tiền (ẩn với nhân viên). Bộ lọc theo giai đoạn.
- **Chi tiết đơn**: bảng dòng hàng (mã, tên, SL, đơn giá, chiết khấu, ngày hẹn, ghi chú NCC), khối tiền (`computeOrderTotals`: tạm tính, VAT, tổng, cọc theo %, đã trả, còn lại), file bản ký, lịch sử đổi ngày hẹn/chiết khấu so với đơn gốc.
- **Nút** = `nextActions(actor, order)`. Bảng đầy đủ: [`NCC-ACTIONS.md`](NCC-ACTIONS.md) (tự sinh).

### 2. Quản lý NCC – `#/suppliers` (Manager và Kế toán thêm / sửa danh bạ; chỉ Manager gắn tài khoản NCC – khu vực `ncc-admin`) ✅ đã làm (đợt 1)
API: `src/modules/suppliers/api/directory-routes.ts` (`GET/POST /suppliers`, `GET/PUT /suppliers/:id`, `PUT /suppliers/:id/accounts`, `GET /supplier-account-candidates`). Giao diện: `trial-ui/suppliers.js` (menu Quản trị → Nhà cung cấp). Sửa NCC có khoá lạc quan `updatedAt` (409 khi người khác vừa sửa); mọi thao tác ghi vào `audit_logs` tự động.

Nơi sửa **mọi thứ về NCC mà trước đây phải sửa code**:

| Mục | Bảng | Ghi chú |
|---|---|---|
| Danh sách / thêm / sửa NCC | `suppliers` | `cleanSupplierInput`; trùng tên (bỏ dấu, hoa/thường, "đ"="d") bị chặn bằng `name_key`. **Không xoá** NCC đã có đơn – chuyển *Ngừng hoạt động*. |
| Email nhận đơn và CC | `supplier_contacts` | `cleanContacts`; điền sẵn khi duyệt đơn (`defaultRecipients`). Tối đa 20 CC. |
| Tài khoản đăng nhập của NCC | `supplier_accounts` | `planAccountLink`: chỉ gắn tài khoản chức vụ NCC đang hoạt động; mỗi tài khoản thuộc đúng một NCC. **Đây là nơi quyết định ai thấy đơn của NCC nào** (thay cho so email và hai email viết cứng của bản cũ). |

### 3. Đơn mua NCC – `#/purchases` (khu vực `business`) ✅ đã làm (đợt 2)
Đơn mua = `incoming_shipments` với `source = 'supplier-order'` (dùng chung bảng với cổng NCC). Quyền chi tiết ở `src/modules/suppliers/domain/purchasing.ts` (`checkPurchase`, `purchaseActions`); máy chủ trả `actions` cho từng đơn, giao diện chỉ ẩn/hiện nút.

**Hai quyết định đã chốt**
- **Nguồn tồn chính là Sapo.** CRM không cộng tồn. Mỗi phiếu nhận (`supplier_receipts`) có trạng thái nhập kho Sapo riêng: `pending` → `done` (bắt buộc mã phiếu Sapo) / `failed` (bắt buộc ghi lỗi, phiếu vẫn giữ để xử lý tiếp) / `not_needed`. Phiếu đã `done` không nhận "done" lần hai (chặn cộng tồn hai lần). Chỉ Manager mở lại được, sau khi đã huỷ phiếu nhập trên Sapo.
- **Quyền ghi thanh toán:** Manager và Kế toán ghi khoản trả và sửa lịch trả. Chỉ Manager huỷ khoản trả; khoản đã huỷ vẫn giữ trong lịch sử.

| Bước | Ai | Ghi chú |
|---|---|---|
| Lập đơn từ báo giá / đơn-HĐKT / khách hỏi tồn | Mọi nhân viên (chỉ chứng từ mình được xem) | Liên kết nguồn lưu ở `supplier_order_sources`. Có thể chia một lần lập ra nhiều NCC, mỗi NCC một đơn. **Chống mua trùng:** với mỗi (chứng từ, mã), số đã đặt ở các đơn chưa huỷ cộng số đặt lần này không được vượt số cần. Có khoá advisory nên hai người lập cùng lúc cũng không vượt được. Với khách hỏi tồn, số cần = số khách hỏi trừ số đã báo đáp ứng. |
| Sửa nháp | Người lập hoặc Manager | Khoá theo `revision`. Nhân viên không thấy giá; giá Manager đã nhập được giữ nguyên. Lịch sử sửa ghi lại thay đổi số lượng theo từng mã. |
| Duyệt giá / chiết khấu / lịch trả | Manager | Gồm không cọc, cọc theo % hoặc theo số tiền, trả nhiều đợt, hạn trả phần còn lại. Email nhận đơn mặc định lấy từ danh bạ NCC. |
| Ghi nhận NCC xác nhận và ngày hẹn | Manager (thay NCC, khi chưa có cổng NCC) | `confirmed_on_behalf = true`. Ghi được ngày hẹn riêng cho từng mã và số đơn phía NCC. |
| PDF đơn mua | Manager, Kế toán (cần giá) | Tạo ở trình duyệt (`trial-ui/purchase-pdf.js`), không ghi lên máy chủ. |
| Nhận hàng từng đợt | Kho, Manager | Ghi theo từng mã: đạt / hỏng / ghi chú. Hàng hỏng không tính vào số đã nhận, vẫn tính là còn thiếu. `clientKey` duy nhất, nên bấm lặp không tạo phiếu thứ hai. Số đạt không được vượt số còn thiếu; ngày nhận không được sau hôm nay. |
| Huỷ phiếu nhận | Manager | Chỉ huỷ được khi phiếu chưa nhập Sapo. |
| Trả NCC | Manager, Kế toán | Khoản trả có `clientKey`, không được vượt số còn nợ, đính kèm được chứng từ ảnh/PDF ≤ 6 MB (lưu ở kho file private). Công nợ tính FIFO theo lịch trả, có quá hạn và kỳ tới. |
| Huỷ đơn | Người lập (đơn nháp) / Manager | Bắt buộc ghi lý do. Không huỷ được khi đã nhận hàng hoặc đã trả tiền. Huỷ xong, số đã đặt được trả lại cho chứng từ nguồn. |

**Nhập đơn mua từ file Excel tổng đơn của NCC (Manager)** – nút "Nhập từ file NCC" ở trang Đơn mua (mẫu file Minh Long).
- **Cột đọc:** Đơn hàng (số đơn phía NCC) · Ngày giao gốc · Mã hàng · Tên hàng · Sl đặt · ĐG Bán · Chiết khấu · SL giao. Các cột khác bỏ qua.
  - Tìm cột theo tiêu đề; không thấy dòng tiêu đề thì đọc theo vị trí cột A, E, F, G, L, O, Q, R.
  - Mã hàng đọc dạng chữ nên giữ số 0 đầu.
- **Gom đơn:** các dòng cùng "Đơn hàng" gom thành một đơn mua. Mã lặp trong đơn có cùng giá và CK thì cộng số lượng.
- **Thông tin chọn trên màn hình nhập:** NCC, địa chỉ giao hàng (áp cho mọi đơn), VAT (mặc định 8%).
- **Xem trước:** liệt kê cảnh báo, ví dụ trị giá trong file khác SL × giá × (1 − CK), hoặc thiếu giá / số lượng (dòng đó bị bỏ qua).
- **Đơn tạo ra:** ở trạng thái **đã duyệt + NCC đã xác nhận**, ghi số đơn NCC, ngày hẹn từng mã, giá + CK theo file. Lịch trả mặc định: một kỳ "còn lại" chưa đặt hạn.
- **Số đã giao (cột SL giao):** ghi thành một phiếu nhận với trạng thái Sapo "không cần nhập" (hàng đã nhập Sapo từ trước). Phiếu này không ghi sổ kho.
- **Nhập lại file:** số đơn đã có (cùng NCC, chưa huỷ) được bỏ qua, nên nhập lại không tạo trùng.
- **Code:**
  - đọc file: `trial-ui/purchase-import.js`;
  - API: `POST /purchase-orders/import`;
  - test: `tests/app/purchase-import.test.ts`, `tests/app/purchasing.test.ts`.

**Tồn "Hàng chờ về" tự tính từ đơn mua** (`suppliers/api/incoming-stock.ts`):
- Mỗi mã = tổng số còn thiếu (đặt − đã nhận đạt) của các đơn mua NCC đã duyệt và chưa huỷ.
- Ghi vào kho loại `incoming`; chưa có kho này thì tự tạo kho "Hàng chờ về".
- Hệ thống cập nhật lại sau mỗi thao tác trên đơn mua và mỗi lần mở danh sách đơn mua. Chỉ ghi phần thay đổi; mã không còn chờ thì xoá dòng.
- File danh mục, file tồn và đồng bộ Sapo **không ghi đè** kho này nữa.
- Mã chưa có trong danh mục sản phẩm thì chưa tính (bảng tồn bắt buộc mã có trong danh mục).

Bảng mới (migration `0051_supplier_purchasing`, REVOKE ở `0052`): `supplier_order_sources`, `supplier_receipts`, `supplier_receipt_lines`, `supplier_payment_schedules`, `supplier_payments`, `supplier_order_events` (lịch sử thao tác). Cột mới trên `incoming_shipments`: `note`, `cancelled_*`, `cancel_reason`, `confirmed_on_behalf`, `revision`.

**Việc tự sinh** (`supplierPurchases` trong `tasks/api/auto-tasks.ts`, nguồn `purchase`):
- duyệt đơn: Manager;
- chờ NCC xác nhận: Manager;
- quá hẹn: người lập đơn;
- nhận hàng khi tới hẹn: nhóm Kho;
- nhập kho Sapo: nhóm Kho;
- trả NCC trước hạn 3 ngày: nhóm Kế toán.

Sơ đồ quy trình (khối "Đơn mua NCC") dùng cùng các hàng đợi này.

**Chưa làm (để sau):**
- `supplier_stock_requests` vẫn giữ nghĩa cũ là xin hàng từ đơn sắp về, chưa phải hỏi tồn mọi sản phẩm.
- Gửi email đơn mua tự động.
- Cổng NCC tự xác nhận.

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


## Tải PDF / Excel đơn gửi NCC

- Nút **PDF / Excel gửi NCC** trên chi tiết đơn mua mở hộp chọn mẫu và thông tin điền file. Chỉ người được API cấp action `pdf` (Manager / Kế toán, thấy giá mua) sử dụng; không đổi quyền hiện có.
- **Theo yêu cầu: cả 3 file Excel chỉ lấy sheet thứ 2 theo thứ tự workbook**, kể cả sheet ẩn:
  - Lock: `GIAO KHCM ` trong file VIGIFTS CT – ĐẶT HÀNG 58%…; điền mã ERP (nếu bổ sung), SKU, mô tả, quy cách, SL, giá và tiền.
  - Minh Long thường: `Sheet2` trong `DHNCC-20261002-6674.xlsx`; các cột STT, mã, tên, bộ, hoa văn, chất lượng, SL, NCC và ngày lấy hàng/số đơn.
  - Minh Long in logo: `Form  trien khai mau` trong `FORM ĐẶT HÀNG MINH LONG ĐƠN IN LOGO.xlsx`; nhân viên/chi nhánh NCC, NPP, khách/logo, ngày yêu cầu, ngày maquette, mã/tên/bộ/hoa văn/ĐVT/SL và nội dung logo. Không dùng sheet “Form xac nhan dh” của file này.
- Mỗi file xuất chỉ có một sheet tương ứng. `trial-ui/templates/supplier-orders.json` giữ bố cục, style, vùng gộp và hash SHA-256 file nguồn; loại dữ liệu đơn ví dụ, danh mục ẩn, VLOOKUP và liên kết file ngoài.
- Mã hàng luôn là chuỗi để giữ số 0 đầu. Tên/mã do người nhập bắt đầu bằng dấu = vẫn là văn bản trong Excel.
- Lock tính giá có VAT theo giá mua, chiết khấu đã xác nhận, phí in và VAT từng dòng của đơn hiện tại; không cố định mức 58% hoặc VAT 8% từ mẫu. Dùng công thức có kết quả lưu sẵn để file đọc được trước khi Excel tính lại.
- Các ô ERP/bộ/CL/số Kg chưa có thông tin thì để trống, không suy đoán. Hoa văn và SL/thùng có thể gợi ý từ GET /products; người dùng chỉnh được trước khi tải. Catalog không được dùng để ghi đè giá/SL đã duyệt.
- PDF dùng bố cục đơn đặt hàng khách hàng: tiêu đề công ty, hai cột thông tin, bảng hàng có khung, tổng tiền/VAT, ghi chú và 3 chữ ký. A4 ngang, font Times New Roman tiếng Việt, tự chia trang kể cả ghi chú một dòng hàng dài.
- Thông tin chỉnh trong hộp tải chỉ áp dụng cho file; không lưu đè đơn mua. Không gửi email tự động, không tạo giao dịch hoặc đổi tồn kho.
- Không cần migration. Cần deploy API (bổ sung printDescription/printFee có ẩn giá đúng quyền) và giao diện.

### Địa chỉ giao hàng trên đơn mua

- Form tạo và sửa nháp dùng nhãn **Địa chỉ giao hàng** thay cho Kho nhận. Bắt buộc nhập, bỏ khoảng trắng đầu/cuối, tối đa 120 ký tự.
- API POST/PUT đơn mua kiểm tra lại địa chỉ; một đơn trong lô thiếu địa chỉ thì cả lô không được tạo. Giữ trường API/dữ liệu `warehouse`, không cần migration.
- Kho nhận trên phiếu nhận hàng là thông tin nghiệp vụ nhận hàng riêng, giữ nguyên.

### Số đếm trạng thái và việc chưa hoàn tất

- `GET /purchase-orders` trả thêm `counts`: toàn bộ phạm vi quyền + từ khoá/NCC đang tìm, độc lập thẻ trạng thái được chọn và giới hạn danh sách 300 dòng. Các số đếm được tổng hợp trong PostgreSQL, không cộng từ dữ liệu tải về trình duyệt. Tiến độ nhận bỏ phiếu đã huỷ; tiền nợ chỉ được đếm với người có quyền xem giá.
- Mỗi thẻ trạng thái hiện số đơn, kể cả số 0. Các nhóm Quá hẹn / Chờ nhập Sapo / Còn nợ có thể trùng với nhóm trạng thái chính.
- `GET /navigation-counts` (business, cùng phạm vi quyền của trang đích): `packing` = phiếu đã gửi kho chưa đóng, trừ đơn đã giao/đánh dấu giao xong; `deliveries` = chuyến dự kiến/đang đi/giao lỗi cần xử lý, bỏ chuyến đã giao hoặc huỷ; `purchases` = đơn chưa nhận đủ, chưa huỷ. API chỉ đọc, không tự đóng phiếu cũ.
- Số đỏ ở menu Lịch giao hàng / Phiếu đóng gói / Đơn mua NCC ẩn khi bằng 0. Cập nhật khi đăng nhập, khi nhịp dữ liệu báo thay đổi và sau thao tác lưu liên quan. Phản hồi của tài khoản cũ không ghi đè số của tài khoản mới.
- Không migration, không thay đổi đồng bộ Sapo hay dữ liệu nghiệp vụ.
