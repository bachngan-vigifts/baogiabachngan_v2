# Bán hàng sau báo giá: Đơn đặt hàng · HĐKT · Lịch giao hàng · Công nợ

## Màn kiểm tra trước khi duyệt HĐKT

- Nút **Duyệt HĐKT** mở màn hình đối chiếu toàn trang: thông tin khách hàng, bảng sản phẩm (SL, ĐVT, đơn giá, VAT), giá trị HĐKT, tồn tại các kho bán và ghi chú.
- Ngày giao, kho dự kiến xuất và 5 mục xác nhận nằm ở vùng riêng. Thanh **Quay lại kiểm tra / Duyệt HĐKT** luôn hiện ở cuối màn hình; nội dung cuộn trong một vùng, màn hình nhỏ xếp các phần theo chiều dọc.
- Vẫn phải đánh dấu đủ các mục và chọn ngày giao / kho theo quy định hiện có. Quay lại, đóng hoặc Escape không duyệt HĐKT. Các hộp xác thực khác giữ bố cục hiện tại; không thay đổi API, phân quyền hay cách tính tiền / tồn kho.

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

## Độ chính xác đơn giá từ báo giá

Khi sinh hoặc đồng bộ đơn hàng/HĐKT từ báo giá, giữ nguyên đơn giá sau chiết khấu (cộng phí in theo loại báo giá) và thành tiền dòng trước khi làm tròn. Màn hình chi tiết đơn, bản in/PDF, Excel và Word HĐKT hiển thị đơn giá tối đa 2 số lẻ (Word dùng đủ 2 số).

Tổng trước thuế được làm tròn từ tổng dòng; tổng thanh toán được làm tròn một lần từ tổng dòng và VAT chưa làm tròn, khớp tổng VNĐ hiển thị trên báo giá. VAT ghi nhận bằng tổng thanh toán trừ tổng trước thuế để các tổng luôn cộng khớp (có thể chênh 1đ với việc làm tròn VAT độc lập). Không làm tròn đơn giá trước khi nhân số lượng. Không thay quy tắc POS hoặc tự cập nhật chứng từ cũ đã sinh.

## Hai luồng song song: Đơn hàng và HĐKT (migration `0034_invoice_request.sql`)

- Trên báo giá đã duyệt có một nút **Sinh Đơn hàng / HĐKT**. Bấm vào thì hiện hộp cho nhân viên chọn 1 trong 2:
  - **Đơn hàng**: cho khách đã có HĐ nguyên tắc. Chỉ tạo đơn (giao hàng, xuất hoá đơn, công nợ), không sinh HĐKT.
  - **HĐKT**: mở ngay hộp lập HĐKT (pháp nhân, cọc, hạn thanh toán) → chọn kho Sapo → `POST /contracts { quoteId }` lập HĐKT thẳng từ báo giá, **không sinh đơn hàng**.
- **Trang Đơn hàng** (`GET /orders?flow=order`) chỉ hiện đơn **không có HĐKT**. **Trang HĐKT** hiện các HĐKT. Mỗi trang có nút ＋ để chọn một báo giá đã duyệt chưa có đơn (`GET /order-quote-candidates?q=`) rồi tạo nhanh.
- **Xuất file Đơn hàng**: xuất theo đúng bộ lọc, gồm sheet **Đơn hàng** (mỗi đơn một dòng, có sản phẩm, SL, đơn giá sau giảm trước/sau VAT, phí vận chuyển thu khách và tổng đơn) và **Chi tiết sản phẩm** (mỗi SKU một dòng, các giá trị tiền là số để lọc/cộng). Phí vận chuyển là phí thu khách lưu trên đơn, không thay bằng cước GHN. Tổng đơn lấy từ chứng từ gốc; chiết khấu/voucher đã phân bổ không trừ lại. Dữ liệu cũ thiếu thuế/phí ghi “Chưa có dữ liệu”. Nếu bộ lọc vượt giới hạn 5.000 đơn, yêu cầu thu hẹp bộ lọc thay vì xuất file thiếu đơn âm thầm.
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
  - POS chuyển khoản đã hoàn thành: tự yêu cầu khi có phiếu thu chuyển khoản thật, chưa huỷ và đơn đã thu đủ; QR/khoản chờ, cọc chưa nhận hàng không được coi là hoàn thành. POS tiền mặt tại quầy chỉ yêu cầu khi nhân viên bấm; đơn giao tận nơi áp dụng quy tắc giao xong.
  - Các đơn CRM đã giao / Manager đánh dấu xong giao hàng và POS chuyển khoản cũ đủ điều kiện được bổ sung khi đồng bộ Công việc, không tạo lại đơn đã xuất hoá đơn.
- **Việc tự sinh "Xuất hoá đơn"** (nguồn `invoice`) giao cho **nhóm Kế toán** ngay sau khi giao xong / POS chuyển khoản hoàn thành / nhân viên gửi yêu cầu; có thông báo cho nhóm. Nhãn **Đã giao hàng · Chờ hoá đơn**, hoặc **Yêu cầu xuất hoá đơn** nếu nhân viên yêu cầu trước khi giao. Một khoá `invoice:<orderId>` cho mỗi đơn/HĐKT, giữ người đã nhận việc; không đánh dấu xong tay trước khi nhập số hoá đơn.
- **Đơn website GHN:** webhook WooCommerce hoặc thao tác làm mới đơn đồng bộ `ghn_status=delivered` → nhiệm vụ `invoice-web:<id>` cho Kế toán, kể cả website chưa chuyển `completed`. Không tạo việc cho đơn đang giao, thất bại, hoàn/huỷ. Nhiệm vụ có khách, điện thoại, email, địa chỉ, hàng, tổng tiền và mã GHN; kế toán ghi số hoá đơn vào Trao đổi rồi hoàn thành nhiệm vụ. Webhook gửi lại không nhân đôi hay mở lại nhiệm vụ kế toán đã hoàn thành. Không yêu cầu quyền bán POS để đọc nhiệm vụ.
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

## Chiết khấu theo khách và điều khoản thanh toán trên báo giá
- **Hộp "Tạo báo giá mới":** chọn khách đã đặt CK riêng (trang chi tiết khách hàng) thì ô "Chiết khấu toàn bảng" tự ẩn và hiện CK của khách.
  - Khi thêm sản phẩm, CK được tự áp đúng theo thương hiệu.
  - **Nhận thương hiệu:** Lys (có chữ "Lys"); Lock&Lock (Lock&Lock / LocknLock / Lock & Lock…); Minh Long (gồm Healthy Cook, sứ dưỡng sinh). Mã thuộc thương hiệu khác thì CK = 0.
  - Code: `brandDiscountKey` trong `quotes/domain/quote-math.ts`.
- **Nút "Điều khoản thanh toán"** (bên phải tiêu đề "Ghi chú báo giá"):
  - Đổi tỷ lệ cọc và hạn thanh toán phần còn lại; hiện giới hạn công nợ của khách.
  - Khách có CK riêng: có ô "Áp lại CK riêng của khách cho các dòng". Khách không có: có ô "Chiết khấu toàn bảng" áp cho mọi dòng.
  - Ghi chú thanh toán tự cập nhật; bấm "Lưu báo giá" để lưu.
  - Báo giá đã duyệt thì chỉ Manager dùng được, như các ô khác.

## Giữ hàng cho báo giá (migration `0063_stock_holds.sql`, quyền `0064_supabase_access_stock_holds.sql`)
- **Nút "Giữ hàng 5 ngày"** trên báo giá **đã duyệt**: nhân viên xem được báo giá hoặc Manager bấm. Hệ thống treo tồn kho thật cho từng mã của báo giá, gộp các dòng cùng mã. Mã không có trong danh mục thì bỏ qua.
  - Mỗi mã chỉ treo **phần đang khả dụng**. Thiếu thì báo rõ mã nào cần bao nhiêu và giữ được bao nhiêu.
  - Báo giá đang giữ thì không giữ lần hai.
- **Tồn khả dụng** ở mọi chỗ kiểm tồn = tổng kho thật − **Đang treo**. Đang treo là các dòng giữ còn hạn của báo giá **khác**.
  - Các bảng Kiểm tồn báo giá và Khách hỏi tồn có thêm cột "Tồn kho", "Đang treo" (kèm link tới báo giá đang giữ) và "Khả dụng".
  - Hộp chọn sản phẩm và trang Sản phẩm cũng trừ phần đang treo.
  - Hàng chờ về / tồn NCC không bị treo.
- **Bỏ giữ:** nhân viên xem được báo giá hoặc Manager. **Gia hạn +5 ngày:** chỉ Manager, tính thêm từ hạn hiện tại.
- **Lập Đơn hàng / HĐKT từ báo giá:** treo của báo giá đóng lại (trạng thái `converted`), **đơn / HĐKT giữ thay** (migration `0069_order_stock_holds.sql`).
  - Mọi đơn / HĐKT lập từ nay (kể cả nháp, kể cả lập không qua giữ hàng) tự giữ **phần chưa giao** của từng dòng có mã hàng. Không hết hạn.
  - Thôi giữ khi: **huỷ** đơn / HĐKT; **giao xong** (giao bớt thì giữ phần còn lại); hoặc đơn **đã đẩy Sapo** và tồn nguồn của mã đó được cập nhật **sau lúc đẩy** – web coi lần cập nhật mới là số liệu nguồn và không trừ lần hai.
  - Cột "Đang treo" hiện số đơn / "HĐKT <số>" (bấm mở). Kiểm tồn của chính báo giá đã lập đơn không tự trừ hàng của đơn mình. Báo giá đã lập đơn / HĐKT không bấm "Giữ hàng" thêm được (409 `QUOTE_HAS_ORDER`).
  - Hết hạn giữ hàng báo cho người giữ và **người phụ trách** báo giá (báo giá khách tự gửi không báo cho khách).
  - Đơn có từ trước migration 0069 (`holds_stock = false`) không giữ.
  - Tính ngay khi đọc (`orderHolds` trong `sales/api/hold-routes.ts`), không có bảng riêng; `GET /stock-holds` trả cả dòng báo giá lẫn dòng đơn (`orderId`, `orderNo`, `contractNo`, `expiresAt: null`).
- **Hết hạn:** hết 5 ngày thì không còn trừ khả dụng nữa.
  - Dòng giữ chuyển `expired`; người giữ và người phụ trách báo giá nhận thông báo "Hết hạn giữ hàng" (mỗi báo giá một lần).
  - Việc này chạy ở nhịp `/pulse` (khoảng 30 giây, khi có người đang dùng hệ thống) và khi tải danh sách giữ hàng.
- **API:**
  - `GET /stock-holds`;
  - `GET|POST /quotes/:id/hold`;
  - `POST /quotes/:id/hold/release`;
  - `POST /quotes/:id/hold/extend`.
- **Code:** `src/modules/sales/api/hold-routes.ts`; test `tests/app/stock-holds.test.ts`.

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
  - Không thu vượt số còn lại (khoá dòng đơn khi ghi – bấm hai lần không ghi trùng); ngày thu không sau hôm nay; đơn đã huỷ không ghi thu.
  - Trang Công nợ lọc **Còn phải thu** (mặc định) / **Quá hạn** / **Đã thu đủ**; lọc trong SQL trước khi giới hạn số dòng (đơn cũ còn nợ không bị đẩy khỏi danh sách).
  - Cột **Hạn thu**: "Quá N ngày" (kỳ quá hạn lâu nhất) hoặc hạn kỳ kế tiếp; ô **Tuổi nợ quá hạn** 1–30 / 31–60 / trên 60 ngày; nút **⬇ Excel** tải bảng đang xem.
  - **Huỷ phiếu thu** ghi nhầm (migration `0071_accounting_tools.sql`): Manager / quyền "Huỷ phiếu thu" (mặc định Kế toán), bắt buộc lý do – `POST /payments/:id/void`. Phiếu huỷ vẫn hiện (gạch ngang, ai huỷ, lý do), không tính vào đã thu ở mọi nơi; muốn sửa thì huỷ rồi ghi phiếu mới. Nhật ký thay đổi ghi lại.
  - Trang Đơn hàng / HĐKT có nút lọc **🧾 Chờ xuất hoá đơn** (kèm số) – `?invoice=requested`.
  - Nợ quá hạn: ngoài việc "Thu công nợ quá hạn" cho người phụ trách, nhóm Kế toán có việc "Theo dõi nợ quá hạn" (tự đóng khi khách trả).
- **Sổ quỹ cửa hàng** (`#/cash`): một két chung, ca bàn giao dùng chung POS; phiếu thu/chi thủ công, duyệt phiếu lớn, kết ca đếm tiền và tra soát. Tiền chuyển khoản không vào két. Xem `docs/CASH.md`.
- **Sổ thu / chi** (`#/cashbook`, quyền "Sổ thu / chi" – mặc định Kế toán): phiếu thu khách + phiếu chi NCC theo khoảng ngày (`GET /cashbook?from=&to=`), tổng thu / chi / chênh lệch, tách chuyển khoản / tiền mặt, lọc Thu / Chi, xuất Excel. Phiếu huỷ hiện gạch ngang, không cộng tổng.
- **Công nợ NCC** (trang Đơn mua NCC → nút **💰 Công nợ NCC**, người xem được giá NCC): nợ theo từng NCC (còn nợ, quá hạn, kỳ trả sắp tới), xuất Excel 2 sheet (theo NCC / theo đơn) – `GET /supplier-payables`.
  - Số hoá đơn chỉ nhập cho đơn đã duyệt (không nhập trên đơn nháp / đã huỷ).
- **Huỷ đơn:** chỉ huỷ được khi chưa giao và chưa thu tiền. Đơn huỷ không tính công nợ.
  - Huỷ thì dọn việc còn treo: phiếu đóng gói chưa đóng và chuyến giao chưa giao huỷ theo (việc Kho / giao tự đóng); phiếu kho **đã đóng** ghi dòng đảo trong sổ kho (hàng về lại kho) rồi huỷ.
  - Đơn đã huỷ: không đổi trạng thái chuyến giao (trừ huỷ), không xác nhận đóng hàng, không ghi thu.
- **Quyền:** Manager và Kế toán thấy tất cả. Nhân viên thấy đơn mình phụ trách hoặc mình tạo; HĐKT, chuyến giao, công nợ theo quyền của đơn. NCC không vào được.
  - **Sửa / huỷ / gửi duyệt / đổi ngày giao** đơn hoặc HĐKT nháp: chỉ người phụ trách, người tạo, đồng nghiệp cùng phòng (phạm vi "Cả phòng ban") hoặc Manager. Người chỉ được xem (Kế toán, Sale Admin "Toàn công ty (chỉ xem)", người được duyệt mở đơn chờ duyệt) không sửa đơn của người khác – máy chủ trả 403 `ORDER_EDIT_FORBIDDEN`, giao diện ẩn nút. Báo giá cũng vậy (`canEdit` trong `GET /quotes/:id`).

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


## Lên lịch và đóng gói trong một lần lưu

- Nút chính **Lên lịch & đóng gói** mở một form cho nguồn hàng, người nhận và lịch giao. Nếu đã có chuyến đang chờ/đang giao, mặc định dùng lịch hiện có; người dùng chỉ bật tạo lịch mới khi đây là chuyến khác. Nút **Chỉ lên lịch giao** giữ cho trường hợp chưa cần lập phiếu.
- `POST /orders/:id/packing` nhận thêm `schedule` (tuỳ chọn, thông tin như POST /deliveries) và `sendToWarehouse` (boolean). Có schedule thì lượng giao được lấy từ tổng allocations theo dòng đơn; client không thể gửi một bộ dòng giao khác với lượng đóng gói.
- Lịch và toàn bộ phiếu được ghi trong **một transaction**. Khoá dòng đơn, đọc lại lượng đã phân bổ, trừ các chuyến planned/in_transit và khoá cấp số theo ngày. Sai ngày, nguồn, lượng hoặc địa chỉ xưởng: rollback, không để lại lịch/phiếu/danh bạ xưởng dở.
- Giao dịch tạo lịch dùng chung `sales/api/delivery-store.ts` cho hai đường vào; cộng gộp mã dòng lặp trước khi kiểm phần còn lại để không vượt lượng giao.
- UI gửi `sendToWarehouse=true` khi chỉ một nhóm nguồn. Server cũng kiểm một nhóm: tạo phiếu sent, ghi người/thời điểm gửi và báo nhóm Kho ngay. Nhiều nhóm nguồn luôn tạo draft để người lập kiểm rồi gửi; body cũ không có cờ giữ hành vi nháp như trước.
- Kho vẫn chọn kho xuất và xác nhận kèm 1–3 ảnh; không bỏ kiểm quyền hoặc bỏ bước chứng minh đã đóng hàng. Chuyến planned có thể xác nhận delivered trực tiếp: bước in_transit đã là tuỳ chọn, không cần thay đổi trạng thái/schema. Đã giao vẫn cập nhật lượng giao, yêu cầu hoá đơn và hoàn tất phiếu như trước.
- Nếu giao về xưởng in, thông tin phiếu là nơi nhận của xưởng; lịch giao khách dùng thông tin khách trên đơn, tránh coi giao xưởng là giao xong cho khách.
- Gỡ handler/nút ngầm và dòng trạng thái thuộc luồng yêu cầu đóng gói qua Công việc cũ trên UI. API cũ giữ tương thích dữ liệu/liên kết lịch sử; luồng thao tác hiện tại dùng phiếu đóng gói.
- Không migration. Kiểm thử: packing.test.ts (bao gồm rollback/quyền/chống lặp và tự gửi), fulfilment-ui.test.ts, sales.test.ts; không thử tạo chứng từ trên production.


## Rà soát CRM theo tài khoản (17/10/2026)

- **Trả lại báo giá:** người duyệt bấm **Trả lại…** trên báo giá đang chờ duyệt, nhập lý do → báo giá về nháp, người lập / phụ trách nhận thông báo kèm lý do, sửa rồi gửi duyệt lại. Lý do lưu ở Lịch sử thay đổi.
- **Đơn mua NCC** đã gửi duyệt vào hộp **Cần duyệt**; gửi duyệt báo người duyệt, duyệt / huỷ báo người lập. Việc "Duyệt đơn mua" tự đóng khi đơn được duyệt (không đóng tay).
- **Thông báo thêm:** giao xong / giao thất bại → người phụ trách đơn; kho đóng hàng xong → cả người phụ trách đơn; nhập số hoá đơn → người phụ trách + người yêu cầu; khách tự huỷ đơn trên trang khách → người phụ trách (không có thì Manager).
- **Chuyến giao** đi đúng thứ tự: Chờ giao ⇄ Đang giao → Đã giao / Thất bại; Thất bại → Chờ giao. Đã giao và đã huỷ là trạng thái cuối. Hai người bấm cùng lúc chỉ một lần được ghi (409 `DELIVERY_CHANGED`).
- Người duyệt đổi được ngày giao dự kiến của đơn nháp đã gửi duyệt (đơn đã duyệt vẫn chỉ Manager đổi; nhân viên lên lịch chuyến không đổi ngày đã chốt).
- **Đơn nháp** không ghi thu tiền được (409 `ORDER_NOT_APPROVED`); huỷ đơn kiểm lại trong giao dịch (không huỷ nếu vừa có phiếu thu / hàng đã giao).
- **Kho** không thấy giá bán (danh sách / chi tiết / lịch sử sản phẩm), phí ship chuyến giao, tiền trong lịch sử đơn mua.
- **Lịch sử đơn** (`/audit?entityType=orders&related=1`) gồm cả thao tác trên HĐKT, chuyến giao, phiếu thu, phiếu đóng gói của đơn.
- **Sơ đồ quy trình** của Manager chỉ liệt kê đơn nháp đã gửi duyệt (khớp số đếm).
- Không migration. Test: `tests/app/crm-audit.test.ts`.

## Form hàng trong đơn và HĐKT CRM

Đơn POS và đơn/HĐKT sinh từ CRM dùng cùng bố cục 8 cột: sản phẩm/khoản phí, số lượng, đã giao, đơn giá gốc, CK, giá sau CK, VAT, thành tiền; cùng khối tổng CK, mã giảm giá, tiền hàng/phí chưa VAT, VAT, tổng thanh toán và ghi chú. Khi có hoàn hàng CRM, giữ thêm ba cột lịch sử hoàn/nhập kho/khách giữ và phần lịch sử hiện có.

Giá CRM xuất phát từ báo giá là giá chưa VAT; CK tiền là trên mỗi SP, khác CK tiền POS trên dòng. Khi tạo hoặc sửa đơn từ báo giá, lưu giá gốc/loại CK/giá trị CK/tổng CK vào các cột `sales_order_lines` đã có. Không đổi cách tính `unitPrice`, `amount` hoặc tổng chứng từ. B2B/VIGIFTS đã cộng phí in vào đơn giá sau CK: chỉ chú thích phần đã gồm, không cộng lại hoặc thêm dòng phí lần hai. Khoản phí riêng đã được lập thành dòng trong báo giá hiện như các dòng hàng khác.

Đơn giá gốc/CK của chứng từ cũ không lưu đủ phải hiện chưa có dữ liệu; không lấy giá danh mục hoặc báo giá hiện tại để suy ra giá lịch sử. Tổng tiền/VAT/thanh toán dùng đúng số đã lưu. Giá POS và phí/voucher tiếp tục theo snapshot đã lưu, giữ nhãn gồm/chưa VAT của nguồn. Không tự backfill, sửa chứng từ cũ hoặc thêm migration cho thay đổi này.

Kiểm thử: 26 test liên quan đạt, không skip; gồm renderer POS/CRM, giá lẻ/CK tiền/phí in/nhiều VAT, sửa hợp đồng và hoàn hàng. Kiểm tra API tạo đơn/HĐKT xác nhận giá gốc và CK đi xuyên từ báo giá vào DB. Typecheck/UI build đạt. Browser router thật, dữ liệu giả: 8 trường hợp POS/CRM/HĐKT/chứng từ cũ trên 1440/390 đạt, không lỗi JS/tràn ngang, không request ghi dữ liệu từ thao tác xem.

Đo 3 lượt lạnh/viewport, mạng giả lập 40 ms, 1,6 MB/s: median ready PC 3124→3141 ms, mobile 3081→3074 ms; vẫn 17 API/164 JS. Bản đo đầu biến động, đã lưu cả số chẩn đoán và cặp đo cuối trong `docs/testing/crm-order-line-form-performance.json`. Đây là số cục bộ, không phải tốc độ production. CLS khởi động vẫn cao (PC ~0,466→0,486; mobile ~0,665 giữ nguyên); không coi là bản sửa CLS toàn ứng dụng.
