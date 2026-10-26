# Phiếu NCC và dòng nhập tay báo giá

## Gom phiếu và xác nhận hàng loạt

Trong chi tiết/lịch sử phiếu đã gửi, các dòng được gom theo NCC + số đơn NCC (giữ số 0 đầu). Cùng số nhưng khác NCC không gom. Thiếu số NCC thì nhóm theo đơn mua CRM. Mỗi nhóm chỉ tính số lượng/trạng thái của chính các phân bổ trong nhóm. Phiếu nháp vẫn sửa/gửi bằng luồng cũ.

Các nhóm là phiếu thao tác trong yêu cầu gốc, giữ ID, ngày lấy, lịch sử và ràng buộc nhận hàng; không gộp các yêu cầu lưu ở thời điểm khác nhau hoặc tự sửa phiếu production cũ. Các phiếu cũ nhiều nguồn được hiển thị thành nhóm ngay khi tải.

Manager tick từng phiếu hoặc chọn tất cả rồi xem danh sách xác nhận trước khi gửi. API mới `POST /purchase-early-requests/manager-confirm-batch` nhận tối đa 300 allocation IDs, kiểm quyền Manager ở server, khóa các dòng cha theo thứ tự và cập nhật trong một transaction. Không xác nhận lan sang phân bổ khác của cùng mã/NCC. Đã đồng ý thì bỏ qua, đã từ chối/phiếu nháp/dòng không tồn tại thì chặn toàn bộ lần gọi. Ghi responded_by/at và audit theo yêu cầu gốc; không nhận hàng hoặc ghi kho.

## Tên sản phẩm và tồn kho

API đọc tên đầy đủ từ danh mục theo SKU, fallback tên chứng từ nếu mã chưa có trong danh mục. Không sửa snapshot chứng từ cũ. Trên CRM, tên là nút `data-product-card` dùng thẻ tồn kho/lịch sử chung của báo giá, giữ phân quyền kho hiện hành. Cổng NCC chỉ hiển thị tên, không mở dữ liệu kho nội bộ.

## Dòng trống báo giá

Dòng nhập tay có tên/nội dung chính và một `manualDescription` tùy chọn, bên cạnh SL/đơn giá. Không hiển thị các trường mã, thương hiệu, Bộ gồm, In ấn, Đóng gói của dòng này. Không thay cách tính tiền/thuế hoặc âm thầm bỏ CK/phí in cũ.

Mô tả phụ được lưu trong JSON báo giá, giới hạn 2.000 ký tự. Các mô tả cũ có nội dung được ghép để giữ thông tin; bỏ riêng giá trị đóng gói mặc định. Người dùng xóa mô tả phụ thì xuất chỉ còn dòng chính. PDF canvas/vector HRC/B2B/VIGIFTS và Excel dùng chung hàm mô tả, không tự chèn thương hiệu/đóng gói/in ấn cho dòng nhập tay. Mẫu xuất PDF đổi phiên bản cache.

## Kiểm thử

- PGlite: phân nhóm, đúng allocation, quyền, nháp, thiếu dòng, xác nhận đồng thời/idempotency, rejected rollback, actor/audit, không tạo receipt/stock move, tên danh mục.
- Hồi quy luồng xin hàng, nhận hàng, UI Manager, phép tính báo giá, schema/UI build và typecheck.
- Chromium 390/1280 với router thật/PGlite: chọn nhiều phiếu, xác nhận, mở thẻ tồn, chỉnh/lưu/reload mô tả phụ; xuất PDF ba mẫu và đọc lại chữ bằng pdftotext.

Không deploy, gửi NCC thật, xác nhận phiếu thật hoặc sửa tồn production trong tác vụ.
