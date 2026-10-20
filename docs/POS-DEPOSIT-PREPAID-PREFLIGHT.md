# Đặt cọc tại quầy và ship trả trước — phương án dữ liệu đã duyệt

Ngày 20/10/2026. Anh đã duyệt quy tắc nghiệp vụ trong cuộc trao đổi. Anh đã duyệt phương án dữ liệu và cho tạo migration ngày 20/10/2026. Đang triển khai cục bộ; chưa áp dụng lên production. Phương án đã duyệt trong cuộc trao đổi thay thế các mục chưa chốt của prompt; chưa nhận file thiết kế riêng được nhắc tới trong prompt.

## Quy tắc đã được duyệt

- Giữ nguyên bán tại quầy và COD hiện có, gồm COD thu trước một phần (PR #187).
- Thêm hai lựa chọn độc lập: Đặt cọc — nhận sau; Ship trả trước 100%.
- Cọc mặc định 30%, nút 50%, được nhập số khác lớn hơn 0 đến tổng đơn. Giữ nguyên giá, CK và SL của đơn cọc.
- Giữ hàng 5 ngày, hết hạn nhả giữ nhưng không huỷ đơn/hoàn tiền. Khi khách quay lại sau hết hạn phải kiểm tra và giữ lại đủ hàng trước khi nhận thu nốt.
- Chỉ xuất hàng tại quầy khi đã nhận đủ. Ship trả trước phải nhận đủ trước khi đóng gói/xuất; COD của chuyến bằng 0.
- Chuyển khoản chưa được xác nhận chỉ là yêu cầu chờ, không phải phiếu thu có hiệu lực, không vào két. Tiền thực nhận thuộc ca đang mở tại lúc xác nhận.
- Huỷ trước xuất: mặc định đề nghị hoàn đủ hoặc chuyển tín dụng; không áp dụng phí huỷ. Hàng đã xuất/đã đóng gói đi theo yêu cầu trả hàng, không huỷ thẳng.
- Hoàn tiền dùng cơ chế hiện có: nhân viên lập, Manager/người được chỉ định duyệt, xác nhận thực trả riêng. Manager được tự duyệt, người được chỉ định không tự duyệt. Không bắt buộc ba người khác nhau.
- Khoản thu/hoàn thuộc ca thực tế, báo cáo ca đã kết không thay đổi; đơn chưa tất toán không chặn kết ca.

## Vì sao cần migration

`stock_holds` hiện chỉ gắn báo giá (`quote_id` bắt buộc), không nên tạo báo giá giả cho đơn cọc. `sales_orders.holds_stock` chưa có hạn giữ theo mã/kho. `pos_payment_requests` hiện dành cho QR giỏ hàng có thời hạn 15 phút, không thay thế được yêu cầu thu tiền theo đơn qua nhiều ca.

Đề xuất thêm hai bảng riêng cho hai khái niệm đó, vẫn dùng `customer_payments` cho tiền thực nhận và `pos_returns`/`pos_refunds`/`pos_exchange_allocations` cho huỷ/hoàn/tín dụng. Không tạo bộ sổ quỹ hay luồng duyệt thứ hai.

### Bảng mới `pos_order_reservations`

- `id`: khoá chính; `order_id` FK sales_orders; `order_line_id` FK sales_order_lines; `warehouse_id` FK warehouses; `qty` số lượng dương.
- `status`: active/released/consumed; `expires_at`, `created_at`, `updated_at`.
- `created_by`, `closed_by` FK nhân viên; `closed_at`, `close_reason`.
- Unique `(order_id, order_line_id, warehouse_id)`; index `(warehouse_id, status, expires_at)` và theo order_id.
- Hết hạn được suy ra từ thời điểm hiện tại ngay trong mọi truy vấn khả dụng; không cần cron. Hết hạn không tự đóng đơn hoặc sửa tiền. Giữ lại cùng dòng chỉ sau khi khoá và kiểm đủ tồn, lưu audit thời hạn cũ/mới.
- Mỗi dòng chỉ được tính một lần: loại đơn có reservation ra khỏi cách giữ không thời hạn cũ; tích hợp cả POS, tra tồn, báo giá và đóng gói.

### Bảng mới `pos_payment_intents`

- `id`: khoá chính; `order_id` FK sales_orders; `requested_shift_id` FK pos_shifts; `kind`: deposit/balance/prepaid; `method`: transfer.
- `amount`: nguyên VNĐ, dương; `request_key` unique; `request_hash` để phát hiện dùng lại khoá cho nội dung khác.
- `status`: pending/confirmed/cancelled; `created_by`, `created_at`; `confirmed_by`, `confirmed_at`, `confirmed_shift_id`; `cancelled_by`, `cancelled_at`, `cancel_reason`.
- `payment_id` FK customer_payments, unique; `reference` cho mã tham chiếu xác nhận.
- Index `(order_id, status)` và `(requested_shift_id, status, created_at)`.
- Không ghi customer_payments khi chờ. Xác nhận trong ca đang mở đúng cửa hàng mới tạo phiếu thu, gắn payment_id và đổi trạng thái trong cùng transaction. Sau khi đã nhận đủ từ khoản khác, không được xác nhận thêm vượt dư nợ. Huỷ phiếu thu có lý do không mở lại intent để xác nhận hai lần; lập yêu cầu mới nếu cần.

### Cột mới trong bảng hiện có

- `pos_returns.request_context`: text NOT NULL, mặc định `after_delivery`; các giá trị `before_fulfillment`, `after_issue`, `after_delivery`.
- Cột này phân biệt huỷ tiền cọc khi hàng chưa xuất với hàng đã xuất/đã giao. Không giả lập nhập kho khi chưa xuất. Mặc định giữ nguyên nghiệp vụ và dữ liệu đổi/trả cũ.
- Giữ nguyên `kind=return/exchange`, các quyền duyệt, lịch sử phiếu hoàn và tín dụng hiện có.

### Migration dự kiến

- Một migration nghiệp vụ: tạo hai bảng, cột request_context, CHECK/FK/unique/index; không sửa migration cũ, không cập nhật tiền/đơn cũ.
- Một migration quyền: bật RLS, thu hồi quyền trực tiếp anon/authenticated cho hai bảng mới theo mô hình server-only hiện có. Không tạo policy cho phép client ghi tiền.
- Đã tạo file bằng Supabase CLI sau khi anh duyệt phương án này: `20261020010950_pos_deposit_prepaid.sql` và `20261020011018_supabase_access_pos_deposit_prepaid.sql`. Bước chạy lên production cần được duyệt riêng trước triển khai API phụ thuộc các bảng mới.

## Trạng thái và tiền

Không thêm giá trị vào enum trạng thái đơn. Dùng confirmed/delivered/cancelled và trạng thái đóng gói/giao hiện có; nhãn Còn cọc, Chờ xác nhận, Đã trả đủ, Hết hạn giữ được suy ra từ số thu còn hiệu lực, intent và reservation. Loại luồng lưu trong JSON pos_snapshot (`saleFlow`), dùng fulfillment_mode counter cho nhận tại quầy, delivery cho ship trả trước, giữ cod cho COD hiện có.

Tiền còn thu = max(0, tổng đơn − tổng phiếu thu chưa huỷ). Giá/tổng tính ở server. Khi xác nhận cọc/thu nốt, khoá sổ quỹ và giữ hàng theo thứ tự nhất quán. Thu nốt và xuất hàng là một giao dịch; replay trả chứng từ cũ, không xuất lại. Không dùng riêng nhãn giao diện để mở quyền xuất.

Huỷ chưa xuất giải phóng reservation, vô hiệu các intent còn chờ và lập yêu cầu hoàn/tín dụng dùng bảng đổi/trả cũ khi có tiền đã thu. Phê duyệt không tự chi tiền. Chỉ tạo phiếu chi hoàn ở ca đang mở khi xác nhận thực trả. Phải phân biệt giảm công nợ do huỷ với số tiền thực được hoàn; không hoàn quá tổng thu còn hiệu lực sau các khoản hoàn/tín dụng đã dùng. Đã đóng gói/xuất thì chặn huỷ thẳng ở cả endpoint chung và endpoint POS.

Đơn chờ chuyển khoản được hiển thị thời gian chờ và quyền huỷ trước xuất, không tự huỷ/hoàn. Hạn 5 ngày áp dụng giữ hàng đang chờ/cọc; đơn ship đã trả đủ giữ đến khi xuất hoặc xử lý huỷ. Gia hạn/giữ lại sau hết hạn phải kiểm tồn thực tế.

## Quyền

Không đề xuất permission key mới. Tạo, thu và xuất tại quầy dùng pos.sell, ca đang mở và scope cửa hàng; phê duyệt dùng Manager/người được chỉ định hiện có. Lock không đọc/ghi đơn, intent, reservation hoặc phiếu hoàn của Minh Long và ngược lại. Kiểm server kể cả các endpoint đóng gói, giao hàng và huỷ chung. Manager tự duyệt được audit; người được chỉ định không tự duyệt.

## File dự kiến thay đổi

Mới:
- `src/modules/sales/pos-order-flow-schema.ts`: hai bảng; cột context ở return-schema hiện có.
- `src/modules/sales/domain/pos-order-flow.ts`: số cọc, dư nợ, nhãn và hạn giữ.
- `src/modules/sales/api/pos-order-flow-store.ts`, `pos-order-flow-routes.ts`: giữ/giữ lại, thu nốt, chờ/xác nhận chuyển khoản, xuất và yêu cầu huỷ.
- `trial-ui/pos-order-flow.js`: lựa chọn luồng, form cọc, danh sách đơn nhận sau, thu nốt/xác nhận/huỷ.
- Test domain, API, UI và migration cho các luồng này.

Sửa:
- `src/db/schema.ts`, `src/app/router.ts`: đăng ký schema/routes; `src/modules/sales/return-schema.ts`: request_context.
- `src/modules/sales/api/pos-store.ts`, `pos-routes.ts`, `pos-access.ts`: tạo đơn, báo cáo theo ca, phạm vi cửa hàng và giữ nguyên COD/QR cũ.
- `src/modules/sales/api/hold-routes.ts`, `packing-routes.ts`, `delivery-store.ts`, `routes.ts`, `pos-order-edit.ts`: nguồn khả dụng thống nhất, chặn xuất khi thiếu tiền và khoá giá/SL/CK đơn cọc, huỷ theo tình trạng xuất.
- `src/modules/sales/api/pos-return-routes.ts`, `pos-return-credit.ts`: ngữ cảnh trước/sau xuất, hoàn/tín dụng không nhập kho giả và không vượt tiền đã nhận.
- `trial-ui/pos.js`, `pos.css`, `pos-print.js`, `pos-report.js`, `pos-returns.js`, `app.js`: tích hợp thao tác, phiếu cọc K80, nhãn báo cáo và chi tiết đơn.
- `tests/helpers/pos-fixture.ts`, test POS/cash/returns/holds/packing và migration; tài liệu POS/CASH/DATA-MODEL, trình sinh data model, CI API.
- Hai migration mới chỉ tạo sau duyệt. Không sửa lương, Sapo, cron hoặc luồng đăng nhập.

## Kiểm thử bắt buộc trước bàn giao

Cọc tiền mặt và chuyển khoản chờ/xác nhận; 30%/50%/số khác và làm tròn; thu nốt qua ca khác; thiếu tiền không xuất; hết hạn cạnh tranh giữ hàng và giữ lại trước thu; không tính giữ hai lần; không xuất/thu/hoàn hai lần khi retry đồng thời; huỷ intent/phiếu thu/đơn theo từng trạng thái; hoàn/tín dụng không quá tiền thực nhận; quyền nhân viên/Manager/người chỉ định và scope Lock/ML; báo cáo ca cũ bất biến; COD cũ và đổi/trả cũ không hồi quy.

Chạy typecheck, toàn bộ test suite và kiểm tra trình duyệt desktop/mobile. Báo số pass/fail/skip và phần chưa thử trên máy in K80 hoặc Supabase live. Kết quả triển khai và kiểm thử được ghi trong PR #189. Hai migration mới chưa được chạy lên production; bước đó cần anh duyệt riêng.
