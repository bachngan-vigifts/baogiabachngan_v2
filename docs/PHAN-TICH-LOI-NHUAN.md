# Phân tích lợi nhuận (giai đoạn 1 – lợi nhuận gộp)

Trang `#/profit` (menu *Công việc → Phân tích lợi nhuận*), **chỉ Manager** (có giá vốn – máy chủ kiểm tra quyền). Mô-đun `src/modules/profit/`, chỉ đọc.

## Cách tính (từng đơn, rồi cộng dồn)

| Khoản | Cách lấy |
| --- | --- |
| Doanh thu thuần | Tiền hàng chưa VAT của dòng đơn − hàng khách trả đã ghi nhận (phiếu trả có hiệu lực công nợ) |
| Giá vốn | Đơn từ báo giá: giá vốn dòng báo giá (cùng vị trí, cùng mã + tên) × SL thực của đơn. Không có / đơn POS: **giá nhập gần nhất trước hoặc trong ngày bán** (sổ "Lịch sử sản phẩm", dòng Nhập hàng); không có giá trước đó thì lấy giá nhập sớm nhất sau ngày bán (ghi rõ nguồn) |
| Chi phí trực tiếp | In gia công (dòng báo giá hoặc tổng phí in chia theo SL), hoa hồng / CK khách (như doanh số net KPI), phí ship khi báo giá ghi bên bán trả |
| Lợi nhuận gộp | Doanh thu thuần − giá vốn − chi phí trực tiếp |
| Biên LN gộp | LN gộp ÷ doanh thu **đã đủ giá vốn** |

- **Ghi nhận theo ngày đơn.** Bỏ đơn huỷ; đơn nháp chỉ tính khi HĐKT đã ký (như công nợ / doanh số).
- **Dòng thiếu giá vốn không coi là 0**: loại khỏi lợi nhuận, báo "thiếu giá vốn" (độ phủ giá vốn, danh sách đơn cần bổ sung). Đơn còn dòng thiếu giá vốn chưa trừ phí ship.
- Sổ "Lịch sử sản phẩm" chỉ giữ 20 biến động gần nhất mỗi mã → đơn cũ có thể dùng giá nhập sau ngày bán (nguồn ghi "sau ngày bán").

## Giá vốn lưu lúc bán (giai đoạn 2 – PR-A)

Bảng `sales_line_costs` (một dòng / dòng đơn) + `sales_line_cost_history` (mọi lần đổi). Migration chạy tay `20261115090000_sales_line_costs.sql`, cổng kiểm tra `scripts/sql/assert-sales-line-costs.sql`.

| Nguồn | Mức tin cậy |
| --- | --- |
| Báo giá – Manager **nhập tay** giá vốn | Chính xác |
| Báo giá – theo % CK mua vào / mặc định thương hiệu | Ước tính |
| Giá nhập gần nhất trước / trong ngày bán | Ước tính |
| Giá nhập sau ngày bán (chưa có giá trước đó) | Backfill |
| Manager điều chỉnh (bắt buộc lý do) | Chính xác |
| Đơn cũ chưa có snapshot – tính lại lúc xem báo cáo, **không lưu** | Backfill |

Chưa có giá vốn xuất kho thực tế (sổ kho không ghi giá trị). Không có nguồn → không ghi snapshot → "thiếu giá vốn", không tính 0.

| Sự kiện | Snapshot |
| --- | --- |
| Tạo đơn từ báo giá (`createOrderFromQuote`) | Ghi (lý do `create`) |
| Đơn **nháp** sửa theo báo giá (`syncDraftOrderFromQuote`) | Cập nhật theo báo giá / giá nhập mới (trừ bản Manager đã chỉnh) |
| Duyệt đơn (nháp → đã duyệt) | Tính lần cuối rồi **khoá** (`confirm`) |
| Sửa đơn đã duyệt / sửa đơn POS | Giữ nguyên; dòng mới hoặc **đổi mã** thì ghi lại (lịch sử ghi "Đổi mã A → B") |
| Bán POS | Ghi trong cùng giao dịch thanh toán (`pos`) |
| Giao từng phần | Không đổi (LN ghi nhận theo ngày đơn) |
| Huỷ đơn | Giữ snapshot + lịch sử; báo cáo bỏ đơn huỷ |
| Đổi / trả hàng | Trừ theo giá vốn snapshot của dòng gốc |
| Gửi lặp (cùng mã chống lặp) | Không tạo đơn mới → không ghi thêm; gọi lại không đổi gì |
| Manager điều chỉnh (`PUT /profit/line-costs/:lineId`) | Kiểm tra phiên bản, bắt buộc lý do, ghi giá cũ / mới, người, thời điểm |

Báo cáo: thẻ "Độ tin cậy giá vốn" (doanh thu theo chính xác / ước tính / backfill / thiếu – tổng khớp doanh thu thuần), bộ lọc **Chỉ giá vốn chính xác** (dòng khác coi như thiếu giá vốn).

## Phí đơn POS (giai đoạn 2 – PR-B)

**LN sau chi phí = LN gộp + thu phí của khách (POS) − phí GHN trả hãng.** LN gộp giữ nguyên định nghĩa giai đoạn 1.

| Khoản | Nguồn chuẩn | Ghi nhận | Chống tính hai lần |
| --- | --- | --- | --- |
| Thu phí dịch vụ / ship của khách (POS) | `sales_orders.pos_snapshot.fees`, quy **chưa VAT** | Ngày đơn | Trừ phần hoàn khi trả hàng (`pos_returns.approved_service_fee + approved_shipping_fee`, gồm VAT → quy theo tỉ lệ chưa VAT của bill), chỉ phiếu có hiệu lực công nợ |
| Phí GHN trả hãng (POS) | `pos_snapshot.ghn.fee` (số GHN báo lúc tạo vận đơn) | Ngày đơn | Đơn CRM trừ ship qua lịch giao (`deliveries.shipping_fee`, chỉ khi báo giá ghi bên bán trả); đơn POS không có báo giá nên phần đó luôn 0. Phiếu chi sổ quỹ trả GHN sẽ KHÔNG tính là chi phí ở bước chi nhánh |
| Phí quẹt thẻ / cổng thanh toán | — | — | CRM chưa ghi nhận thanh toán thẻ → **chưa tính**, ghi rõ trên báo cáo |

- [Giả định] Phí GHN tính nguyên số GHN báo (coi như đã gồm VAT, chưa khấu trừ thuế đầu vào).
- Như phí ship báo giá: phần phí cấp đơn chỉ cộng / trừ khi mọi dòng của đơn đủ giá vốn.
- Có vận đơn GHN nhưng chưa có phí → cảnh báo "chưa có phí GHN", không coi là 0.

## Chi phí nhân sự bán hàng (giai đoạn 2 – PR-C)

**LN sau chi phí = LN gộp + thu phí khách − phí GHN − lương & phụ cấp − thưởng (Sale / Sale Admin).**

| Khoản | Nguồn chuẩn | Ghi nhận | Chống tính hai lần |
| --- | --- | --- | --- |
| Lương + phụ cấp, thưởng của Sale / Sale Admin | Bảng lương tháng (`buildPayroll` / `payslipView`: phiếu đã chốt = bản chụp; chưa chốt = tạm tính), qua contract `src/core/contracts/staff-cost.ts` nối ở `src/app/staff-cost.ts` | Theo **kỳ lương** (tháng); chỉ tháng **trọn** trong kỳ lọc | Chi lương bằng tiền mặt trong sổ quỹ **không** tính là chi phí ở bước chi nhánh (đã có ở bảng lương); hoa hồng / CK khách đã trừ ở LN gộp, thưởng HĐKT là thưởng của Sale (khoản khác) |

- `gross` = tổng các dòng **thu nhập** trên phiếu (không gồm khấu trừ: tạm ứng, BHXH phần người lao động, vi phạm). [Giả định] BHXH phần công ty đóng chưa có trên phiếu → chưa tính.
- Thưởng = KPI DS, HĐKT + điều chỉnh kỳ trước, sản lượng, quý, DS, khác; phần còn lại là lương + phụ cấp.
- **Phân bổ**: vào đơn của chính người đó trong tháng, theo doanh thu **đủ giá vốn**, giữ nguyên tổng (làm tròn xuống, phần lẻ dồn theo phần dư lớn nhất). Không có đơn đủ giá vốn → **chưa phân bổ** (liệt kê tên, tháng, lý do).
- Phân bổ trên mọi đơn rồi mới áp bộ lọc → **đối soát toàn công ty**: phân bổ + chưa phân bổ = tổng bảng lương Sale / Sale Admin (hiện ✔ / ⚠ trên trang).
- Kỳ lọc có tháng lẻ (không bắt đầu ngày 01 hoặc không kết thúc cuối tháng): tháng lẻ chưa trừ lương, ghi chú rõ.
- Kỳ lương đã chốt: dùng bản chụp lúc chốt; điều chỉnh sau chốt đi vào kỳ sau theo quy trình bảng lương (không sửa kỳ cũ).

## Chi phí chi nhánh và lợi nhuận công ty (giai đoạn 2 – PR-D)

Chi phí chi nhánh **không chia xuống đơn**; tính ở cấp chi nhánh (quầy POS; Văn phòng / CRM).

| Khoản | Nguồn chuẩn | Ghi nhận | Chống tính hai lần |
| --- | --- | --- | --- |
| Chi vặt két – chi phí hoạt động | `cash_entries` (đã ghi sổ, chưa huỷ), quầy theo ca (`pos_shifts.register_id`) | Ngày tạo phiếu (giờ VN) trong kỳ | Chỉ loại `petty_expense` không mang dấu hiệu trùng (bảng dưới) |
| Lương NVBH / CHT (không thuộc Sale / Sale Admin) | Bảng lương (contract `StaffCostOf`) | Tháng trọn | Chia theo **số ca đã mở** ở từng quầy trong tháng (giữ nguyên tổng); không có ca → chi phí chung |
| Chi phí chung chưa phân bổ | Phiếu lương người không phải Sale và không có ca (văn phòng, kho, quản lý…) | Tháng trọn | Chỉ hiện khi không lọc |
| Chi phí văn phòng (thuê, điện…) | — | — | CRM chưa ghi nhận → **chưa tính**, ghi rõ |

**Phân loại phiếu két** (không phải phiếu chi nào cũng là chi phí):

| Loại | Tính vào chi phí? |
| --- | --- |
| Chi vặt – hoạt động | **Có** |
| Chi vặt ghi trả lương / thưởng / phụ cấp | Không – đã ở bảng lương (liệt kê "cần xác nhận") |
| Chi vặt ghi phí GHN / ship / giao hàng | Không – có thể trùng phí GHN của đơn (cần xác nhận) |
| Chi vặt ghi trả NCC / nhập hàng | Không – đã ở giá vốn (cần xác nhận) |
| Hoàn tiền / trả khách | Không – đã trừ doanh thu qua phiếu trả |
| Tạm ứng | Không – trừ lương sau |
| Nộp két / rút két | Không – chuyển tiền |
| Thu khác | Không – không phải doanh thu bán hàng |
| Điều chỉnh két (chênh lệch) | Chưa tính – cần Manager xác nhận |

[Giả định] Nhận biết chi vặt trùng bằng từ khoá trong tên / nội dung phiếu (lương, GHN / ship, NCC, hoàn tiền); trang liệt kê để Manager kiểm tra.

**Lợi nhuận công ty** (chỉ khi không lọc) = Σ LN sau chi phí của đơn − lương Sale chưa phân bổ − chi vặt chi nhánh − lương quầy − chi phí chung.
Đối soát hiện trên trang:
- Σ LN chi nhánh − lương Sale chưa phân bổ − chi phí chung = LN công ty (tính độc lập từ đơn, phát hiện đơn rơi ngoài chi nhánh);
- Bảng lương các tháng trọn = Sale (phân bổ + chưa) + quầy + chung.

## Xem theo

Ngày / tuần / tháng / năm (biểu đồ LN gộp + bảng), chi nhánh (Văn phòng / CRM, từng quầy POS), nhân viên (người phụ trách đơn), khách hàng, đơn hàng (bấm xem từng dòng: giá bán, giá vốn + nguồn, in, hoa hồng), sản phẩm. Lọc chi nhánh / nhân viên; xuất CSV mở bằng Excel. Cờ **Lỗ** (LN < 0) và **Biên thấp** (< 15%).

## Chưa có (giai đoạn sau)

Chi phí văn phòng ngoài CRM; phí quẹt thẻ (chưa có dữ liệu); đơn web chưa đổi thành đơn CRM; giá vốn bình quân / giá xuất kho thực tế.

API: `GET /profit?from&to&grain&branch&owner&customer`, `GET /profit/orders/:id`.
