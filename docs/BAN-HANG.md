# Bán hàng sau báo giá: Đơn đặt hàng · HĐKT · Lịch giao hàng · Công nợ

## Luồng và liên kết giữa các trang

```
Báo giá ──[Tạo đơn đặt hàng]──▶ Đơn đặt hàng ──[Lập HĐKT]──▶ HĐKT
                                    │  ├─[Lên lịch giao]──▶ Lịch giao hàng ──[Đã giao]──▶ cập nhật "đã giao" của đơn
                                    │  └─[Ghi nhận thanh toán]──▶ Công nợ
                                    └── trang chi tiết đơn (#/orders/<id>) nối tất cả: báo giá gốc, HĐKT, các chuyến giao, kỳ phải thu, phiếu thu
```

- **Báo giá** (đã lưu) có nút **Tạo đơn đặt hàng**. Mỗi báo giá chỉ có một đơn đang hiệu lực; nếu đơn đó bị huỷ thì tạo lại được.
- **Trang chi tiết đơn** là trung tâm:
  - Dải 5 bước Báo giá → Đơn → HĐKT → Giao hàng → Công nợ, bấm vào bước nào thì mở trang của bước đó.
  - Khách hàng, hàng trong đơn (đã giao bao nhiêu), HĐKT, các chuyến giao, kỳ phải thu, phiếu thu.
- **Bốn trang danh sách** đều dẫn về trang chi tiết đơn:
  - **Đơn đặt hàng**
  - **HĐKT**
  - **Lịch giao hàng**: lọc theo khoảng ngày; đổi trạng thái chuyến ngay trên danh sách.
  - **Công nợ**: tổng phải thu, đã thu, còn lại, quá hạn.

## Hai luồng song song: Đơn hàng và HĐKT (migration `0034_invoice_request.sql`)

- Trên báo giá đã duyệt có một nút **Sinh Đơn hàng / HĐKT**. Bấm vào thì hiện hộp cho nhân viên chọn 1 trong 2:
  - **Đơn hàng**: cho khách đã có HĐ nguyên tắc. Chỉ tạo đơn (giao hàng, xuất hoá đơn, công nợ), không sinh HĐKT.
  - **HĐKT**: tạo đơn rồi mở luôn hộp lập HĐKT (cấp số, cọc, hồ sơ Word).
- **Trang Đơn hàng** (`GET /orders?flow=order`) chỉ hiện đơn **không có HĐKT**. **Trang HĐKT** hiện các HĐKT. Mỗi trang có nút ＋ để chọn một báo giá đã duyệt chưa có đơn (`GET /order-quote-candidates?q=`) rồi tạo nhanh.
- Bên dưới, HĐKT vẫn gắn với một đơn (`sales_orders`) để dùng chung lịch giao, công nợ và hoá đơn. Trang chi tiết đơn có HĐKT thì nút quay lại dẫn về trang HĐKT.

## Xuất hoá đơn

- **Cột mới trên `sales_orders`:**
  - `invoice_status`: `none` / `requested` / `issued`;
  - `invoice_requested_at` / `_by` / `invoice_request_note`;
  - `invoice_no`, `invoice_date`, `invoice_issued_at` / `_by`.
- **Yêu cầu xuất hoá đơn:**
  - *Tự động* khi đơn giao xong (người yêu cầu để trống, ghi chú "Tự động: đơn đã giao xong.").
  - Hoặc nhân viên phụ trách bấm **🧾 Yêu cầu xuất hoá đơn** ở ô *Hoá đơn* của đơn (`POST /orders/:id/invoice-request {note}`).
  - Đơn giao xong **trước** bản này không tự yêu cầu; nhân viên bấm tay nếu cần.
- **Việc tự sinh "Xuất hoá đơn"** (nguồn `invoice`) giao cho **nhóm Kế toán** (chức vụ `accounting`), dẫn tới trang đơn.
- **Kế toán hoặc Manager nhập số hoá đơn** (`PUT /orders/:id/invoice {invoiceNo, invoiceDate}`). Khi đó việc tự hoàn thành. Nhập nhầm thì bấm "Sửa số hoá đơn".
- **Kế toán xem được mọi đơn / HĐKT** để nhập số hoá đơn.
- Danh sách Đơn hàng và HĐKT có cột **Hoá đơn**. Lọc đơn chờ xuất: `GET /orders?invoice=requested`.

## Kiểm tồn báo giá

- Nút **Kiểm tồn** trên báo giá: so số lượng từng mã với tồn khả dụng, tồn NCC và hàng chờ về, giống trang *Khách hỏi tồn*. Mã thiếu được đánh dấu đỏ.

## Duyệt báo giá (như web cũ; migration `0008_quote_approval.sql`)

- Cột mới trên `staff_quotations`: `approval_status` (`pending` / `approved`), `approved_at`, `approved_by`.
  - Báo giá chuyển từ web cũ được tính là đã duyệt nếu dữ liệu cũ ghi `approvalStatus: "approved"` hoặc đã có PDF lưu (`pdfKey`).
- **Ai tạo:**
  - Manager tạo → tự động đã duyệt.
  - Nhân viên tạo → *Chờ duyệt*.
- **Sửa báo giá:**
  - Nhân viên sửa **nội dung** báo giá đã duyệt → về *Chờ duyệt*, phải được duyệt lại. Trước khi lưu, giao diện hỏi xác nhận.
  - Lưu mà không đổi gì thì vẫn giữ trạng thái duyệt.
  - Manager sửa thì giữ nguyên trạng thái.
- **Chỉ báo giá đã duyệt** (và đã lưu hết thay đổi) mới:
  - Tải báo giá (PDF A4, Excel theo mẫu cũ).
  - Tạo đơn hàng: máy chủ chặn bằng `409 QUOTE_NOT_APPROVED`.
  - Sinh HĐKT: máy chủ chặn khi báo giá của đơn đang đợi duyệt lại.
- **Thanh nút** trên trang báo giá: Kiểm tồn · Sinh Đơn hàng / HĐKT · Tải báo giá ▾ · Nhân bản · Lưu báo giá · Duyệt (Manager) · Xoá báo giá (Manager).
  - *Sinh Đơn hàng / HĐKT* hỏi chọn luồng; chọn HĐKT thì tạo đơn nếu chưa có rồi mở hộp lập HĐKT.
- **API:**
  - `POST /quotes/:id/approve {revision}`: Manager duyệt đúng phiên bản đang xem; duyệt không tăng phiên bản.
  - `GET /quotes/pending-count`: số báo giá đang chờ duyệt.
  - `DELETE /quotes/:id {revision}`: Manager xoá. Báo giá đã có đơn hàng hoặc HĐKT thì trả 409.

## Bảng dữ liệu (migration `0006_sales_orders.sql`, quyền `0007_supabase_access_sales.sql`)

| Bảng | Ý nghĩa | Liên kết |
| --- | --- | --- |
| `sales_orders` | Đơn đặt hàng. Lưu bản sao khách hàng, tổng tiền, trạng thái `draft/confirmed/delivering/delivered/cancelled` | `quote_id → staff_quotations` (mỗi báo giá một đơn còn hiệu lực), `customer_id → sapo_customers`, `owner_id/created_by → staff_members` |
| `sales_order_lines` | Dòng hàng của đơn: đơn giá sau CK (B2B/VIGIFTS cộng phí in), chưa VAT; `delivered_qty` ≤ `qty` | `order_id → sales_orders` |
| `sales_contracts` | HĐKT, tối đa một HĐKT mỗi đơn. Lưu pháp nhân `BN/VG/QTV`, % và tiền cọc, số ngày thanh toán, nội dung văn bản (`data` JSON) | `order_id` (duy nhất), `quote_id`, `customer_id` |
| `deliveries` | Chuyến giao: ngày, buổi, người nhận, địa chỉ, đơn vị và phí giao; trạng thái `planned/in_transit/delivered/failed/cancelled` | `order_id`, `assignee_id → staff_members` |
| `delivery_lines` | Giao bao nhiêu của từng dòng hàng | `delivery_id`, `order_line_id → sales_order_lines` |
| `payment_schedules` | Kỳ phải thu: `deposit` / `installment` / `balance`, kèm hạn | `order_id`, `contract_id` |
| `customer_payments` | Phiếu thu | `order_id`, `schedule_id`, `customer_id` |

Bảng của web cũ vẫn giữ nguyên, không bị đụng tới:
- `quote_order_followups` (công nợ đơn Sapo);
- `contract_statuses` / `contract_transfers` (HĐKT chuyển sang CRM cũ);
- `contract_counters` (bộ đếm số HĐKT): bảng mới **dùng chung** bộ đếm này.

## Quy tắc

- **Số chứng từ:**
  - Đơn `DH_<yyyymmdd>_<nnn>`, chuyến giao `GH_<yyyymmdd>_<nnn>`, đếm theo ngày.
  - Số HĐKT theo đúng web cũ: `MM-SS/DDMMYYYY/HĐKT/<pháp nhân>-<mã KH hoặc MST>`, số thứ tự theo tháng và pháp nhân, cấp qua `contract_counters`.
- **Tạo đơn từ báo giá:** chép khách hàng và các dòng có tên, số lượng > 0. Người phụ trách đơn = người phụ trách báo giá.
- **Lập HĐKT:**
  - Cần mã khách hàng hoặc MST để cấp số.
  - Kỳ phải thu được lập lại thành **cọc** (đến hạn ngày ký) và **phần còn lại** (đến hạn = ngày giao xong + số ngày thanh toán). Kỳ đã có phiếu thu gắn vào thì giữ nguyên.
- **Đơn chưa có HĐKT:** một kỳ phải thu toàn bộ, đến hạn khi giao xong.
- **Lên lịch giao:**
  - Số lượng không vượt phần còn lại, tức đã trừ hàng đã giao và các chuyến đang chờ.
  - Không chọn dòng nào thì giao hết phần còn lại.
- **Đã giao:**
  - Cộng số lượng vào `delivered_qty`; trạng thái đơn tự chuyển *Đang giao* / *Đã giao xong*.
  - Chuyến đã giao không đổi lại được.
- **Công nợ:**
  - Phải thu = tổng kỳ; đã thu = tổng phiếu thu; còn lại = phải thu − đã thu.
  - Phiếu thu trừ dần vào kỳ đến hạn sớm nhất; phần chưa thu của kỳ đã quá hạn tính là *quá hạn*.
  - Không thu vượt số còn lại.
- **Huỷ đơn:** chỉ huỷ được khi chưa giao và chưa thu tiền. Đơn huỷ không tính công nợ.
- **Quyền:** Manager và Kế toán thấy tất cả. Nhân viên thấy đơn mình phụ trách hoặc mình tạo; HĐKT, chuyến giao, công nợ theo quyền của đơn. NCC không vào được.

## API (khu vực `business`)

| Route | Việc |
| --- | --- |
| `GET /orders?q=&status=` · `GET /orders/:id` | Danh sách (kèm công nợ, HĐKT) · chi tiết đầy đủ |
| `POST /orders {quoteId}` · `PUT /orders/:id/status {confirmed\|cancelled}` | Tạo từ báo giá (409 `ORDER_EXISTS`) · huỷ / xác nhận |
| `GET /contracts?q=` · `POST /contracts {orderId, legalEntity, depositRate, paymentDays, signedDate?, …}` · `PUT /contracts/:id` | HĐKT (409 `CONTRACT_EXISTS`) |
| `GET /deliveries?from=&to=&status=` · `POST /deliveries {orderId, plannedDate, lines?[]…}` · `PUT /deliveries/:id/status` | Lịch giao |
| `GET /receivables?q=&status=open\|overdue\|paid` · `POST /payments {orderId, amount, paidAt, method, …}` | Công nợ, phiếu thu |

## Bước sau (chưa làm trong bản này)

- In / xuất Word HĐKT theo mẫu của web cũ, dùng `sales_contracts.data`.
- Chuyển đơn sang Sapo: cột `sales_orders.sapo_order_id/code` đã có sẵn.
- Phân quyền chi tiết theo chức vụ, ví dụ Kế toán thấy mọi công nợ, Kho thấy mọi lịch giao.
- Chuyển dữ liệu HĐKT và công nợ từ web cũ sang (nếu cần).
