# Chuyển dữ liệu: `incoming-stock/index.json` (R2) → bảng D1

Đặc tả cho script chuyển dữ liệu (Giai đoạn 10). **Nguồn sự thật là code bản cũ** (`lib/product-catalog.mjs`);
chưa đối chiếu với dữ liệu thật vì chưa có file mẫu. Mục "Chưa kiểm chứng" liệt kê những gì cần xác nhận khi có file.

## Cấu trúc nguồn

- `incoming-stock/index.json` = `{ shipments: [...], supplierStockRequests: [...] }`, ghi nguyên cả file với khoá ETag.
- Mỗi phần tử `shipments` là *header* + `stockRows: [{sku, quantity}]` (bản rút gọn, **suy ra từ dòng hàng → bỏ qua**).
- Chi tiết dòng hàng nằm ở file riêng `shipment.key` (`incoming-stock/<id>-<uuid>.json`): `{...header, rows: [...]}`.

## Header → `incoming_shipments`

| JSON | Cột | Ghi chú |
|---|---|---|
| id, ticketNumber, warehouse, arrivalDate, filename | id, ticket_number, warehouse, arrival_date, filename | |
| source | source | `incoming-stock` / `supplier-order` / `supplier-delivery-note`; giá trị lạ → báo lỗi |
| approvalStatus | approval_status | thiếu → `approved` (đúng mặc định bản cũ) |
| supplierStatus, supplierConfirmedAt | supplier_status, supplier_confirmed_at | bản cũ coi là `confirmed` nếu `supplierStatus==='confirmed'` **hoặc** có `supplierConfirmedAt` |
| supplierName, supplierEmail, ccEmail, supplierInternalOrderNumber, quoteNumber | cùng tên (snake_case) | thiếu → `''`. `supplier_name/email` giữ làm ảnh chụp lúc tạo/duyệt đơn |
| (suy ra từ supplierName) | supplier_id | **bắt buộc với đơn `supplier-order`** – xem mục *Danh mục NCC* bên dưới |
| supplierConfirmedBy | supplier_confirmed_by | |
| approvedAt, approvedBy | approved_at, approved_by | |
| depositRate | deposit_rate | chỉ đơn NCC; thiếu → 30 |
| depositRequestedAt/By, depositPaidAt/By | cùng tên | |
| **paidAmount** và **depositPaidAmount** | paid_amount | bản cũ lưu trùng hai tên; lấy `depositPaidAmount ?? paidAmount ?? 0` |
| deliveryNoteId | delivery_note_id | |
| supplierDeliveryReadyAt/By/Mode/Date | delivery_ready_at/by/mode/date | |
| supplierSignatureDownloadedAt/By | supplier_signature_downloaded_at/by | NCC đã tải mẫu về (bản cũ coi cũng là đã qua bước ký) |
| supplierSignatureFile `{key,name,type,size,uploadedAt,uploadedBy}` + supplierSignatureUploadedAt/By | **bảng `incoming_shipment_files`** (kind=signature): r2_key, file_name, mime_type, size_bytes, uploaded_at/by | `image/jpg` → `image/jpeg`; kích thước 1 B–6 MB, nếu ngoài khoảng → báo lỗi; một file cho mỗi phiếu |
| receivedAt, receivedBy, receivedWarehouse, sapoReceiptId, sapoReceiptCode, stockSyncedAt | cùng tên | |
| createdAt, createdBy, updatedAt, updatedBy | cùng tên | `updated_at` thiếu → `created_at` |
| mọi trường còn lại | extra (JSON) | để không mất dữ liệu |

## Dòng hàng (`rows` trong file chi tiết) → `incoming_shipment_lines`

| JSON | Cột | Ghi chú |
|---|---|---|
| sku, name, unit, quantity | sku, name, unit, quantity | |
| price, manualPrice, taxRate, printFee, printDescription | price, manual_price, tax_rate, print_fee, print_description | |
| designImage | design_image | **base64 `data:image/...` (tới ~950 KB) phải đưa lên R2**, lưu khoá; URL https giữ nguyên |
| perCarton, cartonWeight/Length/Width/Height, cartons, weightKg, volumeM3 | cùng tên | ảnh chụp quy cách lúc tạo phiếu |
| `header.itemDiscounts[{sku,purchaseDiscount}]` | purchase_discount | ghép theo SKU không phân biệt hoa thường |
| `header.supplierConfirmations[{sku,purchaseDiscount,promisedDate,supplierNote,confirmed}]` | confirmed_purchase_discount, promised_date, supplier_note, supplier_confirmed | |
| `header.supplierDeliveryReadyRows[{sku,quantity}]` | delivery_ready_quantity | |
| `header.supplierDeliveredRows` | delivered_quantity | **chưa kiểm chứng hình dạng** |

**Bẫy cần xử lý**

1. Dòng "in logo" giả: `type==='print-logo'` hoặc `sku==='IN-LOGO'`. Bản cũ **không coi là hàng**, mà gộp vào dòng sản phẩm liên quan
   (`normalizeSupplierPrintRows`: lấy tên làm `printDescription`, `printFee`, `designImage`). Chuyển dữ liệu phải làm đúng như vậy, không tạo dòng cho chúng.
2. SKU lặp trong một phiếu: bản cũ từ chối, nhưng phiếu `incoming-stock` cũ có thể đã gộp. Nếu nguồn vẫn lặp → báo lỗi, không tự gộp.
3. `quantity` bản cũ làm tròn bằng `stockInteger` (nửa ra xa số 0); giữ giá trị nguồn, không làm tròn lại.
4. File chi tiết (`shipment.key`) không còn tồn tại: bản cũ báo "Không đọc được chi tiết" → script ghi vào báo cáo lỗi, **không tạo phiếu thiếu dòng**.
5. Trùng số phiếu: bản cũ so sánh bằng `toLowerCase()` của JS, còn `lower()` của SQLite chỉ hạ chữ ASCII (test "GIỚI HẠN ĐÃ BIẾT").
   Script phải tự phát hiện cặp trùng kiểu chữ Việt có dấu trước khi ghi.
6. Các số tổng (`subtotal`, `vat`, `total`, `depositAmount`, `remainingAmount`) là **suy ra**, không nhập. Công thức (bản cũ, `supplierOrderDetail`):
   `giá sau CK = price × (100 − chiết khấu)/100`; `tiền dòng = (giá sau CK + printFee) × quantity`; `VAT dòng = tiền dòng × taxRate/100`;
   `tiền cọc = round(total × depositRate/100)`. Chiết khấu dùng giá trị NCC xác nhận nếu có, nếu không thì giá trị manager nhập khi duyệt.
   Dùng chính các tổng này để đối chiếu cũ/mới sau khi chuyển.

## Danh mục NCC (bảng mới: `suppliers`, `supplier_contacts`, `supplier_accounts`)

Bản cũ không có danh mục NCC. Script chuyển dữ liệu phải **dựng danh mục từ dữ liệu đơn** rồi cho Manager rà soát:

1. Gom `supplierName` của các đơn `supplier-order` theo `supplierNameKey()` (bỏ dấu, hạ chữ, gộp khoảng trắng, đ=d). Mỗi nhóm → một dòng `suppliers`;
   tên hiển thị lấy cách viết xuất hiện nhiều nhất. **In ra danh sách nhóm có nhiều cách viết** (vd "Minh Long", "MINH LONG I", "Minh Long 1") để Manager quyết định gộp hay tách – script không tự gộp các tên khác nhau về chữ.
2. `supplier_id` của từng đơn = nhà cung cấp của nhóm đó. Đơn có `supplierName` rỗng: bản cũ không cho tạo nên không được xuất hiện; nếu có → báo lỗi, không bỏ qua.
3. `supplier_contacts`: mỗi `supplierEmail` khác nhau trong nhóm → liên hệ `order`; mỗi email trong `ccEmail` → liên hệ `cc`.
4. `supplier_accounts`: với mỗi tài khoản có chức vụ NCC, tìm NCC có `supplierEmail` trùng email tài khoản (đúng cách bản cũ so khớp). Tài khoản không khớp NCC nào → **liệt kê để Manager gắn tay**.
5. **Hai email viết cứng** `bachngankg@gmail.com`, `sales.bachngankg@gmail.com` (bản cũ cho thấy mọi đơn có tên NCC chứa "minh long"): gắn cả hai vào nhà cung cấp "Minh Long". Nếu có nhiều nhà cung cấp tên chứa "minh long" thì bản cũ cho thấy tất cả – bản mới chỉ gắn được một; script báo để Manager chọn.
6. Báo cáo cuối: số đơn thấy được trước/sau cho từng tài khoản NCC phải **bằng nhau** (so bằng `listApprovedSupplierOrders` bản cũ và `portalOrderScope` bản mới).

## `supplierStockRequests` → `supplier_stock_requests` + `supplier_stock_request_lines`

Header: `id, status(pending|accepted|rejected), supplierName, supplierEmail, note, createdAt, createdBy, createdByName, createdByPositionId, respondedAt, respondedBy, responseNote`.
Dòng: `orderId→shipment_id, sku, name, unit, quantity, maxQuantity, arrivalDate`, `line_no` theo thứ tự mảng.
Dòng trỏ tới phiếu không còn tồn tại thì bỏ (bản cũ cũng lọc như vậy khi phản hồi).

## Chưa kiểm chứng (cần file thật)

- Hình dạng `supplierDeliveredRows`, `supplierConfirmedBy`, `sourceSkus`, `stockSyncedRows`, và phần xử lý `supplier-delivery-note` (`confirmSupplierDeliveryNote`).
- Tồn tại các giá trị `source`/`approvalStatus`/`status` ngoài danh sách trên.
- Quy mô thực tế (số phiếu, kích thước file index) để chọn kích thước lô khi nạp D1.

## Kiểm tra sau khi chuyển (bắt buộc)

Với mỗi phiếu: số dòng, tổng `quantity`, `subtotal`/`vat`/`total` tính lại phải **khớp** giá trị bản cũ tính từ cùng dữ liệu nguồn;
số phiếu nguồn = số phiếu đích + số phiếu bị loại trong báo cáo lỗi.
