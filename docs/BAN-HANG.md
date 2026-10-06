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
- **Quyền:** Manager thấy tất cả. Nhân viên thấy đơn mình phụ trách hoặc mình tạo; HĐKT, chuyến giao, công nợ theo quyền của đơn. NCC không vào được.

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
