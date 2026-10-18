# Bán hàng nhanh (POS)

POS dùng đơn bán, phiếu thu, lịch giao và sổ kho hiện có. Route: `#/pos`.

## Chuẩn bị đưa lên web

Áp dụng các migration hiện có của main trước, sau đó chạy theo thứ tự:

1. `migrations/postgres/20261018093740_pos_sales.sql`
2. `migrations/postgres/20261018093741_supabase_access_pos.sql`
3. `migrations/postgres/20261018122409_cash_drawer.sql`
4. `migrations/postgres/20261018122409_supabase_access_cash_drawer.sql`

Migration thứ nhất thêm cấu hình quầy, mẫu ca, ca bán, kiểm đếm đầu ca, yêu cầu QR, mã vạch và các cột liên kết vào chứng từ cũ. Không chuyển đổi hay ghi số dư tồn hiện có. Migration thứ hai thu hồi quyền truy cập trực tiếp sáu bảng mới từ PUBLIC/anon/authenticated; truy cập qua API có kiểm quyền. Các file chưa được áp dụng production trong quá trình phát triển.

Manager mở **Bán hàng nhanh → Cấu hình**: chọn kho thật, gắn đúng hai bảng giá có sẵn, VAT và thông tin ngân hàng. Có thể thêm nhiều quầy; mỗi quầy chỉ mở một ca, mỗi nhân viên chỉ có một ca đang mở. Mẫu ca mặc định là ca sáng 08:00–14:00; có thể thêm mẫu khác. Quầy phải có tồn đầu kỳ trong sổ kho trước khi mở ca.

## Giá và chiết khấu

- **Giá bán lẻ (+ VAT)** là bảng giá mặc định của quầy. Giá đã gồm thuế: server tách thuế từ giá này, không cộng VAT lần nữa.
- **Giá bán lẻ** là bảng giá thứ hai, không cộng VAT.
- Sau mỗi lần bán, POS trở lại bảng giá mặc định, khách lẻ và tiền mặt.
- Nhân viên được nhập chiết khấu % hoặc VNĐ. VNĐ giảm trên **tổng dòng**, không phải mỗi sản phẩm. Chỉ giới hạn toán học: 0–100% hoặc không vượt giá trị dòng. Server lấy lại giá danh mục và tính tiền; bỏ qua giá/tổng client gửi.
- Khách mới được tạo qua POS dùng ngay, không cần duyệt; các luồng tạo khách khác giữ quy trình hiện có.

## Tồn kho

Kho của quầy lấy số dư từ `stock_balances` sau chốt đầu kỳ. Bán tại quầy ghi đơn, dòng hàng, thu tiền và xuất kho trong cùng một giao dịch. Giữ hàng đang có từ báo giá/đơn hàng được trừ khỏi khả dụng; dữ liệu giữ hàng cũ chưa phân theo kho nên áp dụng bảo thủ trên kho quầy để tránh bán hàng đã giữ. Hàng đã xuất qua đóng gói không bị giữ trùng lần nữa.

Danh mục, chi tiết sản phẩm và luồng giữ hàng báo giá đọc số dư CRM cho các kho đã cấu hình POS và có đầu kỳ; các kho khác vẫn đọc snapshot cũ. Đồng bộ Sapo không ghi đè sổ kho POS. Khi kho POS đã có phát sinh, không được chốt lại đầu kỳ từ Sapo; Manager dùng phiếu điều chỉnh có lý do.

Đơn COD giữ hàng trong luồng đơn/giao hàng hiện có. Đóng gói từ kho phải chọn đúng kho quầy. Xác nhận giao chỉ xuất phần chưa được đóng gói xuất kho; không xuất lần thứ hai. Khi đã xuất trực tiếp qua xác nhận giao, không xác nhận thêm phiếu đóng gói cho đơn đó.

## Thu tiền và in

Phải mở ca trước khi bán. Manager thiết lập số dư đầu kỳ tại Sổ quỹ một lần. Mỗi két chỉ có một ca đang mở; tiền đầu ca lấy từ số thực đếm ca trước, nhân viên không nhập lại tuỳ ý. Mở ca kiểm đếm nhanh tối đa ba mã tồn nhiều nhất; kiểm đếm chỉ lưu đối chiếu, không tự điều chỉnh tồn.

Tiền mặt có tiền khách đưa/tiền thối và nút **Đủ tiền**. Chuyển khoản và VietQR đều yêu cầu nhân viên xác nhận cửa hàng đã thực nhận tiền. QR chỉ tạo yêu cầu, hết hạn sau 15 phút; giỏ/giá thay đổi phải tạo QR mới. Không có xác nhận ngân hàng tự động.

**Thu tiền & in** lưu chứng từ trước khi mở in. Mất mạng hoặc mất phản hồi: dùng **Kiểm tra lại giao dịch** để lấy lại đúng đơn bằng mã chống lặp đã lưu trong sessionStorage, không thu lần nữa. Dữ liệu này không chứa token. **In lại bill** chỉ in snapshot đã lưu.

**In bill tạm** ghi rõ “BILL TẠM TÍNH - CHƯA THANH TOÁN”, không có số đơn chính thức, không tạo đơn, phiếu thu hay xuất kho. Bill tạm không lưu để tra cứu. In bằng trình duyệt, khổ 80mm; máy in phải được cài trên máy cửa hàng. Chưa có điều khiển ESC/POS trực tiếp.

## Kết ca và COD

Ca kết có snapshot cố định: số bill, giá trị bill, chiết khấu, tiền mặt, chuyển khoản và COD. Tiền két hệ thống = tiền đầu ca + tiền mặt thực thu + thu thủ công đã ghi − chi thủ công đã ghi. Phiếu chờ duyệt chặn kết ca. Mọi chênh lệch khác 0 cần chọn lý do (Khác cần ghi chú) và tự mở tra soát; kết ca gọi lặp chỉ có một kết quả. Nhân viên xem ca/bill của mình; Manager xem tất cả. Lịch sử giao diện hiển thị 50 ca gần nhất.

COD chưa thu không vào két. Cho kết ca khi còn COD chưa thu; danh sách tiếp tục theo két chung sang ca sau, kể cả đổi nhân viên. Chỉ xác nhận thu sau khi chuyến đã giao và cửa hàng thực nhận tiền. Khoản thu gắn **ca đang mở lúc xác nhận**, không sửa báo cáo ca cũ. Thu COD bằng chuyển khoản không cộng tiền mặt. Báo cáo tách thu của chuyến giao trong ca, thu chuyến ca trước, và đã giao chưa thu.

POS không đẩy đơn sang Sapo, không sửa module lương/cron/phiên Sapo. Chưa có nghiệp vụ hoàn tiền/đổi trả POS; Manager/Kế toán được huỷ phiếu thu có lý do. Ca đã kết giữ báo cáo và mở lại tra soát; nhân viên có ca mới được ghi lại khoản thực nhận tại chi tiết đơn tại quầy mà không xuất hàng lần nữa. COD vẫn thu qua đúng chuyến giao.
