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

## Xem theo

Ngày / tuần / tháng / năm (biểu đồ LN gộp + bảng), chi nhánh (Văn phòng / CRM, từng quầy POS), nhân viên (người phụ trách đơn), khách hàng, đơn hàng (bấm xem từng dòng: giá bán, giá vốn + nguồn, in, hoa hồng), sản phẩm. Lọc chi nhánh / nhân viên; xuất CSV mở bằng Excel. Cờ **Lỗ** (LN < 0) và **Biên thấp** (< 15%).

## Chưa có (giai đoạn sau)

Lợi nhuận sau chi phí (thưởng Sale từ bảng lương, chi phí cửa hàng từ sổ quỹ); phí GHN của đơn POS; đơn web chưa đổi thành đơn CRM; giá vốn bình quân.

API: `GET /profit?from&to&grain&branch&owner&customer`, `GET /profit/orders/:id`.
