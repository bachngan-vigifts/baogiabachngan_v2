# Quy tắc số chứng từ

Chứng từ tự sinh dùng `TÊN_PHIẾU_NNN_DDMMYYYY`:

| Chứng từ | Ví dụ ngày 22/10/2026 |
| --- | --- |
| Đơn hàng CRM | DH_001_22102026 |
| Bán hàng nhanh | POS_001_22102026 |
| Báo giá HRC | HRC_BG_001_22102026 |
| Báo giá B2B | B2B_BG_001_22102026 |
| Báo giá VIGIFTS | VG_BG_001_22102026 |
| Phiếu giao hàng | GH_001_22102026 |
| Phiếu đóng gói | DG_001_22102026 |

Số thứ tự riêng theo loại và ngày, toàn công ty, tối thiểu 3 chữ số; sau 999 là 1000. DH dùng ngày đặt đơn, BG dùng ngày báo giá, GH dùng ngày dự kiến giao, DG dùng ngày lập phiếu theo giờ Việt Nam, POS dùng ngày bán theo giờ Việt Nam. Giữ nguyên mốc ngày nghiệp vụ hiện có.

Không đổi số chứng từ đã lưu. Khi cấp số mới, tìm cả mẫu cũ `PREFIX_YYYYMMDD_NNN` (BG cũ là `HRC_BGYYYYMMDD_NNN` / B2B / VG) và mẫu mới cùng ngày, lấy số lớn nhất + 1. Không lấp khoảng trống do huỷ đơn hoặc QR hết hạn. Số gõ tay và quy tắc HĐKT giữ nguyên.

Máy chủ giữ khoá giao dịch khi cấp số; các nhân viên dùng chung dãy. Gợi ý trên trình duyệt và dự phòng báo giá dùng cùng hàm thuần với máy chủ. Số QR được giữ trước trong JSON yêu cầu thanh toán; checkout dùng đúng số đã hiển thị, kể cả qua ngày. QR cũ đã phát hành vẫn dùng số/token cũ và vẫn được đối soát.

Kiểm tra: hàm thuần (7 tiền tố, ngày/tháng/năm, năm nhuận, reset ngày, >999, mẫu cũ/mới, LIKE escape); API trộn số cũ/mới và tạo đồng thời BG/DH/GH/DG, POS QR/checkout/Webhook/replay; luồng bán hàng, đóng gói, Sapo, bundle UI; typecheck và UI build. Không migration, không đổi dữ liệu production.
