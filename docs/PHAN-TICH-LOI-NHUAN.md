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

## Xem theo

Ngày / tuần / tháng / năm (biểu đồ LN gộp + bảng), chi nhánh (Văn phòng / CRM, từng quầy POS), nhân viên (người phụ trách đơn), khách hàng, đơn hàng (bấm xem từng dòng: giá bán, giá vốn + nguồn, in, hoa hồng), sản phẩm. Lọc chi nhánh / nhân viên; xuất CSV mở bằng Excel. Cờ **Lỗ** (LN < 0) và **Biên thấp** (< 15%).

## Chưa có (giai đoạn sau)

Lợi nhuận sau chi phí (thưởng Sale từ bảng lương, chi phí cửa hàng từ sổ quỹ) – PR-C / PR-D; phí GHN, phí quẹt thẻ đơn POS – PR-B; đơn web chưa đổi thành đơn CRM; giá vốn bình quân / giá xuất kho thực tế.

API: `GET /profit?from&to&grain&branch&owner&customer`, `GET /profit/orders/:id`.
