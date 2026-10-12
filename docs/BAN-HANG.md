# Bán hàng sau báo giá: Đơn đặt hàng · HĐKT · Lịch giao hàng · Công nợ

## Luồng và liên kết giữa các trang

```
Báo giá ──[Sinh đơn hàng]──▶ Đơn đặt hàng
        └─[Lập HĐKT]──────▶ HĐKT          (2 luồng độc lập: HĐKT KHÔNG sinh từ đơn hàng)
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
  - **HĐKT**: mở ngay hộp lập HĐKT (pháp nhân, cọc, hạn thanh toán) → chọn kho Sapo → `POST /contracts { quoteId }` lập HĐKT thẳng từ báo giá, **không sinh đơn hàng**.
- **Trang Đơn hàng** (`GET /orders?flow=order`) chỉ hiện đơn **không có HĐKT**. **Trang HĐKT** hiện các HĐKT. Mỗi trang có nút ＋ để chọn một báo giá đã duyệt chưa có đơn (`GET /order-quote-candidates?q=`) rồi tạo nhanh.
- **HĐKT và đơn hàng độc lập.** Bên dưới, HĐKT có một bản ghi `sales_orders` đi kèm để dùng chung dòng hàng, lịch giao, công nợ và hoá đơn. Bản ghi này **ẩn với người dùng**:
  - Trang chi tiết HĐKT là `#/contracts/<id>`. Link cũ `#/orders/<id>` của HĐKT tự chuyển sang đây.
  - Trang chi tiết HĐKT **không có** nút / mẫu in đơn đặt hàng; nút chính là **Xem / tải hồ sơ HĐKT**.
  - Mọi nơi đều hiện **số HĐKT**, không hiện số đơn `DH_…`: danh sách, giao hàng, công nợ, phiếu đóng gói, việc tự sinh, thông báo, hộp duyệt, lịch sử sản phẩm, chat, trang khách, trang khách hàng / nhân viên, ghi chú đơn Sapo.
  - Hàm dùng chung: `sales/domain/doc-ref.ts` (máy chủ) và `docLink` / `docHref` (giao diện).
  - Báo giá đã lập HĐKT thì không sinh đơn hàng nữa (và ngược lại). Không lập HĐKT từ một đơn hàng.

## Xuất hoá đơn

- **Cột mới trên `sales_orders`:**
  - `invoice_status`: `none` / `requested` / `issued`;
  - `invoice_requested_at` / `_by` / `invoice_request_note`;
  - `invoice_no`, `invoice_date`, `invoice_issued_at` / `_by`.
- **Yêu cầu xuất hoá đơn:**
  - *Tự động* khi đơn giao xong (người yêu cầu để trống, ghi chú "Tự động: đơn đã giao xong.").
  - Hoặc nhân viên phụ trách bấm **🧾 Yêu cầu xuất hoá đơn** ở ô *Hoá đơn* của đơn (`POST /orders/:id/invoice-request {email, mode, note}`). Hộp yêu cầu có:
    - **email nhận**: mặc định email trên đơn / của khách, sửa được, nhiều email thì cách nhau bởi dấu phẩy;
    - **cách xuất**: *Phát hành hoá đơn* (`issue`) hoặc *Gửi bản nháp* cho khách kiểm tra trước (`draft`);
    - **ghi chú** cho kế toán.
  - Đơn đã yêu cầu mà chưa xuất: bấm *Sửa yêu cầu* để đổi email / cách xuất / ghi chú. Hai cột `invoice_email`, `invoice_mode` (migration `0039_invoice_email_mode.sql`).
  - Đơn giao xong **trước** bản này không tự yêu cầu; nhân viên bấm tay nếu cần.
- **Việc tự sinh "Xuất hoá đơn"** (nguồn `invoice`) giao cho **nhóm Kế toán** (chức vụ `accounting`), dẫn tới trang đơn.
- **Kế toán hoặc Manager nhập số hoá đơn** (`PUT /orders/:id/invoice {invoiceNo, invoiceDate}`). Khi đó việc tự hoàn thành. Nhập nhầm thì bấm "Sửa số hoá đơn".
- **Kế toán xem được mọi đơn / HĐKT** để nhập số hoá đơn.
- Danh sách Đơn hàng và HĐKT có cột **Hoá đơn**. Lọc đơn chờ xuất: `GET /orders?invoice=requested`.

## Phiếu đóng gói (migration `0035_packing_slips.sql`, quyền `0036_supabase_access_packing_slips.sql`)

- **Ô *Lịch giao hàng* của đơn có nút 📦 Yêu cầu đóng gói.** Hộp mở ra liệt kê từng dòng còn chưa có phiếu:
  - **Cần đóng**: mặc định bằng phần còn lại của dòng trong đơn.
  - **Lấy từ kho**: mặc định bằng tồn khả dụng (số liệu giống trang *Khách hỏi tồn*), tối đa bằng số cần đóng.
  - **Kho không đủ:** hiện cảnh báo và thêm sẵn một dòng nguồn khác cho phần còn lại. Nguồn khác gồm: điều chuyển từ cửa hàng, nhập từ NCC, đại lý, khác. Mỗi nguồn khác phải ghi rõ tên cửa hàng / NCC / đại lý.
  - Tổng kho + các nguồn khác phải đúng bằng số cần đóng.
- **Lưu**: mỗi (nguồn, tên nguồn) sinh **một phiếu** `DG_<yyyymmdd>_<nnn>`, ở trạng thái nháp.
  - Mỗi dòng của phiếu có **gợi ý quy cách** (số thùng chẵn + lẻ, kích thước thùng) và **cân nặng ước tính**, lấy từ thông tin thùng của sản phẩm trong danh mục.
- **Gửi kho** (nhân viên phụ trách / Manager):
  - phiếu chuyển sang *Đã gửi kho*;
  - việc tự sinh **"Đóng gói …" cho nhóm Kho** (chức vụ `warehouse`), dẫn tới trang phiếu `#/packing/<id>`;
  - cả nhóm Kho nhận thông báo.
- **Kho xác nhận đã đóng** trên trang phiếu:
  - bắt buộc **1–3 ảnh**, tự nén ở trình duyệt (cạnh dài ≤ 1280px, ≤ ~330 KB), lưu trong `packing_slip_photos`;
  - việc tự hoàn thành;
  - người gửi phiếu được báo.
- **Huỷ phiếu** (nháp / đã gửi) thì số lượng trả lại để lập phiếu khác. Phiếu đã đóng không huỷ được.
- **Quyền:** nhóm Kho xem và xác nhận mọi phiếu nhưng không xem được đơn. Danh sách phiếu chờ đóng: `#/packing`.
- **API:**
  - `GET/POST /orders/:id/packing`;
  - `GET /packing?status=`, `GET /packing/:id`;
  - `POST /packing/:id/send | cancel | confirm {photos[], note}`.
- Nút cũ "Yêu cầu kho đóng hàng" theo từng chuyến giao được bỏ. Việc cũ đã tạo vẫn hiện tình trạng.

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
  - *Sinh Đơn hàng / HĐKT* hỏi chọn luồng; chọn HĐKT thì mở hộp lập HĐKT (không sinh đơn hàng).
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

- ~~In / xuất Word HĐKT theo mẫu của web cũ~~ – đã làm (`trial-ui/contract-ui.js`, 6 mẫu `.docx`).
- Chuyển đơn sang Sapo: cột `sales_orders.sapo_order_id/code` đã có sẵn.
- Phân quyền chi tiết theo chức vụ, ví dụ Kế toán thấy mọi công nợ (Kho đã thấy mọi lịch giao và phiếu đóng gói).
- Chuyển dữ liệu HĐKT và công nợ từ web cũ sang (nếu cần).

## Tiến trình sản phẩm (migration `0049_order_progress.sql`, `0050_supabase_access_order_progress_marks.sql`)
- **Thanh 5 bước** ở trang chi tiết đơn / HĐKT để mọi người cùng theo dõi: **Duyệt → Xuất kho → In mẫu → Sản xuất → Giao hàng**.
  - Đơn / HĐKT **không có phí in** thì bỏ hai bước In mẫu và Sản xuất.
  - Nhãn tình trạng theo bước đang làm: Đợi duyệt, Chờ xuất kho, Đang in mẫu, Đang sản xuất, Đang giao hàng, Đã giao hàng.
- **Tự xong theo chứng từ / công việc:**
  - Duyệt: Manager duyệt đơn / HĐKT.
  - Xuất kho: kho xác nhận đã đóng gói một phiếu đóng gói của đơn.
  - In mẫu: xuất kho xong → tự sinh việc "In mẫu …" cho người phụ trách; hoàn thành việc → bước xong.
  - Sản xuất: tự sinh việc "Sản xuất …"; hoàn thành việc → bước xong.
  - Giao hàng: đơn đã giao đủ.
- **Manager hoàn thành nhanh:**
  - Bấm "Xong" ở một bước → xong bước đó và mọi bước trước.
  - "Hoàn thành tất cả" → xong cả đơn.
  - "Bỏ" → gỡ dấu tay ở bước đó và các bước sau.
  - API: `POST /orders/:id/progress { stage | 'all', done }`.
- **Chỉ là tiến trình theo dõi:** không đổi trạng thái đơn, lịch giao, công nợ, hoá đơn.
- **Lưu trữ:** `order_progress_marks` (bước xong theo việc / dấu tay). Các bước theo chứng từ tính trực tiếp, không lưu.
- **Code:** `sales/domain/progress.ts`, `sales/api/progress.ts`, `progress-routes.ts`; việc tự sinh `productionSteps` trong `tasks/api/auto-tasks.ts`.


## Form sinh đơn hàng từ báo giá

- Chọn **Sinh đơn hàng** mở form ngay, lấy dữ liệu báo giá đã lưu qua API CRM; không kiểm tra Sapo trước.
- Form: ngày đặt, ngày hẹn giao, địa chỉ giao, ghi chú. Ghi chú chỉ lấy thời gian giao hàng, địa chỉ giao hàng và thanh toán từ `data.notes` của báo giá, cho sửa riêng hoặc xoá, tối đa 20.000 ký tự; không sửa lại báo giá.
- Chọn **Không – chỉ sinh trên web** (mặc định): gửi `pushSapo: false` thẳng tới API, không gọi preview/kết nối Sapo.
- Chọn **Có**: sau khi gửi form mới mở bước kiểm tra Sapo/chọn kho, cùng cách HĐKT. Sapo lỗi vẫn cho chuyển sang chỉ sinh trên web, giữ nguyên thông tin đã nhập.
- Các giá trị được lưu vào cột có sẵn: `order_date`, `expected_delivery_date`, `address`, `note`; không migration. Nếu không gửi ghi chú, đơn mới mặc định lấy ghi chú báo giá; gửi `note: ''` thì để trống.
- Đơn vẫn tạo ở trạng thái nháp, phải được Manager duyệt. Phân quyền báo giá và chống tạo trùng giữ nguyên.


## Form chỉnh mẫu In/Tải đơn đặt hàng

Popup In/Tải có form bên trái và bản xem trước bên phải, tương tự hồ sơ HĐKT. Sửa được thông tin đơn/khách hàng, ngày đặt/ngày hẹn giao, địa chỉ, ghi chú và ba người ký. Form và các ô sửa trực tiếp trên giấy đồng bộ hai chiều; trước khi in/PDF/Excel đều cập nhật cùng snapshot. Các chỉnh sửa này dành riêng cho bản xuất, không lưu thay đổi vào đơn nghiệp vụ. Điện thoại xếp form phía trên bản xem.


Ghi chú mặc định dùng ngày giao dự kiến đã nhập và địa chỉ giao riêng nếu có, thay cho thông tin mặc định. Khi đổi ngày/địa chỉ trên form, chỉ hai dòng tương ứng cập nhật; giữ điều khoản thanh toán đã chỉnh. Helper dùng chung cho server và trình duyệt, không sửa ghi chú báo giá hoặc đơn đã tạo.

## Chẩn đoán lỗi tạo đơn Sapo

Form sinh đơn gửi `pushSapo` là boolean rõ ràng: chỉ `true` mới yêu cầu đẩy Sapo. Lựa chọn chỉ trên web gửi `false`. Khi Sapo từ chối tạo nháp, thông báo và log kèm mã nội bộ an toàn (ví dụ `SAPO_HTTP_422`), không trả nội dung phản hồi gốc, cookie hay token. Cần kiểm tra trên Sapo trước khi thử lại để tránh tạo trùng.


## Đẩy Sapo sau khi đã sinh chứng từ

Trang chi tiết đơn hàng/HĐKT có **Tạo đơn Sapo** nếu chưa có liên kết và người xem có quyền; sau khi liên kết hiện **Xem đơn Sapo**. Nút tạo mở popup chọn kho và gửi `POST /orders/:id/sapo`; số đối chiếu là số đơn/HĐKT đã cấp, không tạo thêm chứng từ CRM. Không đẩy chứng từ đã huỷ. Nhân viên chỉ đẩy nháp mình phụ trách/tạo; chứng từ đã duyệt chỉ Manager đẩy, theo quy tắc khoá sửa trước đó. Kiểm quyền ở server, không chỉ ẩn nút.

Endpoint khóa bản ghi đơn trong giao dịch, kiểm lại liên kết sau khóa để hai yêu cầu cùng lúc chỉ đẩy một lần. Nếu đã có `sapo_order_id`, trả liên kết ngay mà không cần kho/phiên Sapo. Lỗi Sapo giữ nguyên chứng từ CRM; popup dùng lời nhắc dành cho chứng từ đã có. Không migration, không sửa phiên hay cron Sapo.


## Quyền giữa đồng nghiệp cùng phòng ban

Phòng ban trong app dùng nhóm/chức vụ hiện có (`staff_members.position_id`), không dùng nhóm lương. Nhân viên đang hoạt động, chưa xoá và có cùng nhóm được xem báo giá, đơn/HĐKT, chăm sóc, khách liên quan và doanh số của nhau. Cùng nhóm sửa được báo giá/đơn/HĐKT **nháp**; chứng từ đã duyệt/ký/hoàn tất vẫn chỉ Manager sửa/xoá. Không tự cấp quyền duyệt, chia sẻ tiếp hoặc đổi người phụ trách. Người chưa có nhóm không tự thấy nhau. Manager và quyền chia sẻ trực tiếp có sẵn giữ nguyên.

`staff/api/department.ts` cung cấp điều kiện Drizzle có tham số bind; `quotes/api/department-access.ts` kết hợp quyền sở hữu/chia sẻ cũ với quyền phòng ban. Mọi API danh sách/chi tiết/sửa kiểm quyền ở server. Chăm sóc và Công việc của đồng nghiệp chỉ xem; quyền ghi/xoá nhật ký/trao đổi không mở theo quyền sửa nháp chứng từ.

Hồ sơ đồng nghiệp chỉ trả thông tin nghiệp vụ: `payroll: null`, không gọi hàm đọc/tính lương, không trả tham số lương, ngày công hoặc tài khoản ngân hàng từ hồ sơ lương. Hồ sơ của mình và Manager giữ quyền lương cũ; các endpoint HR giữ nguyên kiểm quyền. Giao diện ẩn thẻ/tab lương và ngày công khi không có quyền. Không migration, không sửa module HR, phiên Sapo hay cron.
