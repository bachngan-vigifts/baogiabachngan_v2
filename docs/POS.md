# Bán hàng nhanh (POS)

POS dùng đơn bán, phiếu thu, lịch giao và sổ kho hiện có. Route: `#/pos`.

## Chuẩn bị đưa lên web

Áp dụng các migration hiện có của main trước, sau đó chạy theo thứ tự:

1. `migrations/postgres/20261018093740_pos_sales.sql`
2. `migrations/postgres/20261018093741_supabase_access_pos.sql`
3. `migrations/postgres/20261018122409_cash_drawer.sql`
4. `migrations/postgres/20261018122409_supabase_access_cash_drawer.sql`

Migration thứ nhất thêm cấu hình quầy, mẫu ca, ca bán, kiểm đếm đầu ca, yêu cầu QR, mã vạch và các cột liên kết vào chứng từ cũ. Không chuyển đổi hay ghi số dư tồn hiện có. Migration thứ hai thu hồi quyền truy cập trực tiếp sáu bảng mới từ PUBLIC/anon/authenticated; truy cập qua API có kiểm quyền. Các migration này đã được áp dụng production ngày 18/10/2026.

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

Phải mở ca trước khi bán. Manager thiết lập số dư đầu kỳ tại Sổ quỹ một lần. Mỗi két chỉ có một ca đang mở; tiền bàn giao tham chiếu lấy từ số thực đếm ca trước (ca đầu lấy đầu kỳ Manager chốt). Nhân viên bắt buộc tự nhập tổng tiền mặt thực đếm, ô ban đầu để trống; tiền nguyên VNĐ từ 0 trở lên. Nếu lệch, giao dịch mở ca tạo tra soát ngay nhưng vẫn cho bán. Tiền trong ca được tính từ số thực đếm mới, không cộng/trừ chênh lệch bàn giao thêm lần nữa. Theo yêu cầu cập nhật ngày 18/10/2026, mở ca không còn bước kiểm đếm nhanh và API mở ca không yêu cầu hoặc ghi số đếm. Form chỉ gồm quầy, ca làm việc, tiền thực đếm đầu ca và ghi chú. Chốt tồn đầu kỳ/kiểm kê thực hiện riêng tại Sổ kho. Dữ liệu kiểm đếm lịch sử vẫn được giữ và chỉ hiển thị trên báo cáo ca cũ nếu có.

Tiền mặt có tiền khách đưa/tiền thối và nút **Đủ tiền**. Chuyển khoản và VietQR đều yêu cầu nhân viên xác nhận cửa hàng đã thực nhận tiền. QR chỉ tạo yêu cầu, hết hạn sau 15 phút; giỏ/giá thay đổi phải tạo QR mới. Không có xác nhận ngân hàng tự động.

**Thu tiền & in** lưu chứng từ trước khi mở in. Mất mạng hoặc mất phản hồi: dùng **Kiểm tra lại giao dịch** để lấy lại đúng đơn bằng mã chống lặp đã lưu trong sessionStorage, không thu lần nữa. Dữ liệu này không chứa token. **In lại bill** chỉ in snapshot đã lưu.

**In bill tạm** ghi rõ “BILL TẠM TÍNH - CHƯA THANH TOÁN”, không có số đơn chính thức, không tạo đơn, phiếu thu hay xuất kho. Bill tạm không lưu để tra cứu. In bằng trình duyệt, khổ 80mm; máy in phải được cài trên máy cửa hàng. Chưa có điều khiển ESC/POS trực tiếp.

## Kết ca và COD

Ca kết có snapshot cố định: số bill, giá trị bill, chiết khấu, tiền mặt, chuyển khoản và COD. Tiền két hệ thống = tiền đầu ca + tiền mặt thực thu + thu thủ công đã ghi − chi thủ công đã ghi. Phiếu chờ duyệt chặn kết ca. Mọi chênh lệch khác 0 cần chọn lý do (Khác cần ghi chú) và tự mở tra soát; kết ca gọi lặp chỉ có một kết quả. Nhân viên xem ca/bill của mình; Manager xem tất cả. Lịch sử giao diện hiển thị 50 ca gần nhất.

COD chưa thu không vào két. Cho kết ca khi còn COD chưa thu; danh sách tiếp tục theo cùng két của quầy sang ca sau, kể cả đổi nhân viên. Chỉ xác nhận thu sau khi chuyến đã giao và cửa hàng thực nhận tiền. Khoản thu gắn **ca đang mở lúc xác nhận**, không sửa báo cáo ca cũ. Thu COD bằng chuyển khoản không cộng tiền mặt. Báo cáo tách thu của chuyến giao trong ca, thu chuyến ca trước, và đã giao chưa thu.

POS không đẩy đơn sang Sapo, không sửa module lương/cron/phiên Sapo. Chưa có nghiệp vụ hoàn tiền/đổi trả POS; Manager/Kế toán được huỷ phiếu thu có lý do. Ca đã kết giữ báo cáo và mở lại tra soát; nhân viên có ca mới được ghi lại khoản thực nhận tại chi tiết đơn tại quầy mà không xuất hàng lần nữa. COD vẫn thu qua đúng chuyến giao.


## Rà soát prompt sửa lỗi POS (18/10/2026)

Đối chiếu từ bf94d53 (#163) với main mới hơn đã có quầy mặc định theo chức vụ và két riêng (#164–165), không quay lùi các sửa này.

- Người dùng đã xác nhận **giữ chính sách cũ**: khách tạo ở POS dùng ngay, nhân viên tự nhập chiết khấu trong giới hạn toán học. Không thêm `pos.discount`, ngưỡng 5%, lý do/luồng duyệt chiết khấu hoặc chặn bill 0đ theo quyền mới. Đây là thay đổi chính sách và tính năng phê duyệt mới, không phải lỗi của yêu cầu đã chốt. Khách pending từ luồng khác vẫn bị server POS từ chối; test bổ sung để giữ điều kiện này.
- Quyết định mới nhất: **bỏ hẳn kiểm đếm nhanh khi mở ca** vì cửa hàng có hàng nghìn mã. Không chọn phương án A hay B, không thêm danh sách cấu hình/migration. UI không tải danh sách và không gửi counts. API mở ca không yêu cầu counts; payload counts từ client cũ được bỏ qua, không ghi 0 giả hoặc thay đổi tồn. Bảng/dữ liệu lịch sử vẫn giữ nguyên; báo cáo mới không ghi kiểm đếm 0 mã. Endpoint đọc opening-counts còn giữ để tương thích client cũ, không dùng trong luồng UI mới.
- Lịch sử ca dùng tên nhân viên do server trả về; không dùng mã nội bộ làm tên hiển thị. Nhãn thu/chi, giá trị đơn, thu tiền và COD dùng helper `trial-ui/pos-report.js` chung cho popup/K80.
- `bills.revenue` vốn là giá trị đơn đã lập, có cả đơn COD; `cash` vốn chỉ cộng phiếu thu tiền mặt hợp lệ. Không trừ `cod.pending` khỏi `cash` hoặc khỏi tổng bill: pending là số còn phải thu của **cùng két**, có thể gồm ca trước và có thể đã thu một phần, nên trừ tiếp sẽ sai. Đổi nhãn thành **Giá trị đơn đã lập (gồm COD)**; tiền mặt thực thu, chuyển khoản, COD đã giao chưa thu được hiển thị riêng, popup và bản in khớp nhau. Không sửa công thức, dữ liệu đã chốt hoặc snapshot ca cũ.
- Không cần migration, schema hay quyền mới. Không đổi lương, Sapo, cron, tồn đã chốt hoặc quy tắc COD. Kiểm thử bằng DB cục bộ và Chromium với dữ liệu giả, không tạo giao dịch trên Supabase; chưa thử máy in K80 vật lý.

## Ngoại lệ phê duyệt tại POS

Theo chính sách đã chốt: khách tạo tại POS dùng ngay, nhân viên bán được tự nhập chiết khấu tới 100% trong giới hạn giá trị dòng, và bill tổng 0 đồng được phép. Đây là ngoại lệ của POS đối với luồng duyệt chứng từ thông thường; không tự thêm bước Manager duyệt. Server vẫn tính lại tiền và chặn dữ liệu không hợp lệ. Phiếu thu/chi thủ công từ ngưỡng cấu hình vẫn phải duyệt. Theo cập nhật 19/10/2026, Manager được tự duyệt phiếu của mình; nhân viên được chỉ định duyệt vẫn không được tự duyệt.

Điện thoại có **Bán nhanh** và **Sổ quỹ** ở đầu thanh điều hướng dưới; từng mục chỉ hiện khi tài khoản có quyền tương ứng, cùng kiểm quyền như menu máy tính.

## Tiền thực đếm khi mở ca (19/10/2026)

Dùng lại `cash_reconciliations` và nhật ký đã có, không thêm migration. Một ca vẫn có tối đa một tra soát. So sánh mở ca được lưu bất biến trong audit mở ca và trả trong `openingComparison` trên báo cáo/chi tiết tra soát. Nếu cuối ca cũng lệch, cùng tra soát được cập nhật/mở lại với số cuối ca; phần so sánh đầu ca vẫn hiện riêng. Kết ca khớp không tự đóng tra soát đầu ca chưa xử lý. Manager giải quyết theo luồng giải trình/đóng hiện có; tra soát không tự sửa sổ két. Gửi lặp yêu cầu mở ca không tạo ca/tra soát trùng, đổi số tiền với cùng mã yêu cầu bị từ chối.

## Sửa đơn đã sinh từ POS

Manager mở chi tiết Đơn đặt hàng → **Sửa đơn POS**. Form chọn khách có sẵn hoặc sửa thông tin khách trên riêng đơn (không sửa hồ sơ khách gốc), địa chỉ/người nhận của chuyến chờ giao hoặc đang giao, và ghi chú điều kiện thanh toán. Mọi lần lưu cần lý do và revision; form cũ bị từ chối khi đơn đã đổi. Nhật ký ghi giá trị trước/sau.

Đơn COD chưa thu, chưa giao/xuất, chưa có phiếu đóng gói hay HĐKT, có tối đa một chuyến chờ giao toàn bộ hàng được sửa số lượng, giá niêm yết và CK trên các dòng hiện có. Giá nhập theo chính sách bill gốc (có VAT/không VAT), giữ thuế suất, server dùng posLine tính lại tiền; không nhận tổng từ client. Giao dịch kiểm tồn khả dụng trừ hàng giữ khác, cập nhật dòng hàng, snapshot bill, lịch thu, số tiền COD, số lượng chuyến giao và lịch sử sản phẩm. Không ghi xuất kho hoặc tạo phiếu thu khi sửa. Không đổi SKU/thêm/xoá dòng trong form này.

Đơn đã thu/xuất hàng vẫn sửa được thông tin liên hệ và ghi chú; không sửa lùi số lượng/giá trị hoặc chuyển khách liên kết khi còn phiếu thu hiệu lực. Phiếu thu sai dùng **Huỷ phiếu…** có lý do rồi ghi thu lại theo luồng hiện có; báo cáo ca đã chốt giữ nguyên. Chuyến đã giao giữ thông tin giao lịch sử.

Chi tiết đơn COD có nút **Thu COD** cho chuyến đã giao còn tiền chưa thu. Nút dùng lại `/pos/cod/:id/collect`, yêu cầu xác nhận thực nhận và ca đang mở đúng két, tiền mặt/chuyển khoản. Không mở cơ chế thu khác hay sửa trực tiếp phiếu thu. Ghi chú thanh toán không làm thay đổi trạng thái đã thu. Không thêm bảng/cột/quyền/migration.

## Chọn khách tại POS

Popup chọn khách dùng ô tìm kiếm có gợi ý theo tên/số điện thoại, không hiện sẵn danh bạ. Ba nút **Khách lẻ – Khách B2B – Khách mới** tách rõ: hai nút đầu lọc kết quả tìm theo phân loại khách đã có (`kind=retail`/`business`), nút cuối mở form tạo nhanh hiện tại. Khách B2B là nhóm không đánh dấu `is_retail`; không tự phân loại lại khách cũ. Nút Khách lẻ chỉ hiện theo quyền danh sách khách lẻ do server trả về. **Khách vãng lai · Không lưu hồ sơ** giữ luồng bán không gắn khách. Có thể dùng phím ↑/↓ và Enter để chọn gợi ý. Không đổi dữ liệu, schema hoặc quyền.
