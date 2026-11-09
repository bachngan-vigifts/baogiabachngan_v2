# Đơn website trong Danh sách đơn đặt hàng

## Hành vi

- Trên bảng đơn cửa hàng ở POS, bấm dòng vẫn vào chi tiết đơn CRM. Nút **Xử lý GHN** riêng của đơn web chờ xử lý/chưa có mã vận đơn mở trực tiếp form địa chỉ GHN hiện có; không tải chi tiết đơn và không tạo vận đơn trước khi người dùng kiểm tra, xác nhận. Quyền và phạm vi cửa hàng vẫn kiểm tra ở API xử lý GHN.

- Trang chi tiết dùng cùng các ô Khách hàng / Đơn hàng / Hàng trong đơn / Giao hàng / Công nợ / Hoá đơn / Thanh toán của CRM; bản in chỉ mở khi bấm In. Kế toán nhập và sửa số, ngày hoá đơn ngay trên đơn web, kể cả khi GHN đã giao thành công.
- Bấm dòng đơn web trên bảng đơn POS (hoặc Enter/Space khi chọn dòng) mở thẳng `#/orders/web:<id>` cho cả Lock và Minh Long. Nút **Xử lý GHN** trong chi tiết mở riêng thao tác vận đơn; mở dòng không tự gửi lệnh GHN.
- Dòng đơn POS hiển thị mã GHN và trạng thái hãng bằng tiếng Việt; đơn web/COD chưa có mã ghi “Chưa tạo GHN”. Đơn COD có nhiều chuyến hiển thị từng mã/trạng thái, kể cả vận đơn đã huỷ. Dữ liệu lấy từ snapshot CRM, không gọi GHN khi mở danh sách; giao thành công không đồng nghĩa đã thanh toán. Vận đơn COD được đọc theo lô chỉ cho trang đang xem.
- Có form sửa tên, MST, địa chỉ và email xuất hoá đơn, tách khỏi người nhận/địa chỉ GHN. Nhập hoá đơn không tạo thêm đơn bán, phiếu thu hoặc bút toán kho. Đơn đã huỷ/hoàn phải xử lý hoá đơn theo quy trình điều chỉnh.
- Thông tin hoá đơn lưu bền vững trong `crm_edit_snapshot.accounting`, giữ nguyên qua đồng bộ website, có revision riêng và audit. Cùng nội dung gửi lại trả kết quả cũ; hai bản sửa cùng revision không được ghi đè. Ghi metadata và audit trong cùng giao dịch; lỗi audit rollback toàn bộ.
- Lưu số hoá đơn chuyển trạng thái sang `issued`, bỏ khỏi bộ lọc Chờ xuất và tự đóng việc kế toán. Hoàn thành việc mà chưa nhập số vẫn chỉ là `handled`, không được coi là đã có hoá đơn. Đơn đã có số hoá đơn cũng khoá sửa giỏ hàng/giá trước GHN để tránh lệch chứng từ.
- Đơn Lock và Minh Long được hiển thị ngay khi đã nhận vào CRM, trước cả lúc tạo GHN. Danh sách kết hợp với đơn CRM/POS, phân trang/sắp xếp theo cùng một tập ID ở máy chủ; tìm theo số nguồn hoặc tên đầy đủ đều được.
- Mã CRM: `Web_<số đơn web>_<Tên khách hàng>`, ví dụ `Web_21569_C trang`. Mã được lưu lần đầu nhận dữ liệu đầy đủ và không đổi khi website cập nhật tên khách. Đơn cũ chưa có mã lưu dùng cùng định dạng khi đọc, không viết lại tiền/kho lịch sử.
- Giữ nguyên số đơn website, website nguồn và ID gốc. URI chi tiết dùng namespace `web:<id>`. Đây là giao diện cho chính bản ghi web đang có, không tạo một bản sao `sales_orders`, phiếu thu, ca/két hoặc bút toán kho thứ hai.
- Xem SKU, tên, đơn vị, số lượng, giá trước CK/mã giảm trên đơn, giảm đã phân bổ, tiền hàng, VAT, coupon/đổi điểm, phí thu khách và tổng. Không coi subtotal của Woo là giá bán lẻ niêm yết toàn danh mục.
- Lọc nhân viên không tự gán đơn web cho người bấm xác nhận. Bộ lọc hoá đơn không coi dữ liệu web chưa có xác nhận hoá đơn là “chưa xuất”. Thanh toán không có timestamp từ nguồn là chưa rõ, không tự tính thành đã thu hoặc chưa thu; tổng còn phải thu ghi rõ phần chưa biết.
- Phạm vi cửa hàng dùng chung `posStoreScopeFor`: NVBH Lock không mở/sửa đơn Minh Long và ngược lại. Manager/Kế toán/Sale Admin xem theo quyền hiện có; chỉ người có `pos.sell` mới sửa. Không mở quyền tiền/kho thông qua ID ảo.

## Sửa hàng trước GHN

- Chỉ sửa khi chưa có mã **và** trạng thái GHN, chưa xuất kho, chưa kết thúc và chưa bắt đầu tạo/đối soát vận đơn. Quầy ngừng hoạt động không nhận sửa mới.
- Nhân viên thay/thêm/bỏ SKU từ danh mục, nhập số lượng, đơn giá đã gồm VAT, CK dòng theo % hoặc VNĐ/dòng, giảm thêm cả đơn, phí vận chuyển/phí khác và VAT của phí.
- Tìm hàng qua catalog quầy hiện tại, có tồn khả dụng tham khảo. Bản sửa không tạo giữ hàng mới; tồn thực vẫn kiểm tra/ghi theo luồng web–GHN hiện có.
- Bộ tính dùng `posLine` và `allocatePosVoucher`: phân bổ giảm trước khi tách VAT; không trừ lại coupon/điểm đã nằm trong giá trị dòng nguồn. Phí GHN theo hãng tách khỏi phí vận chuyển thu khách.
- Nhập lý do, xác nhận đã kiểm tra giá/VAT/phí, bấm **Kiểm tra tổng tiền**, sau đó **Lưu bản sửa**. API tính lại, so tổng với bản xem trước, kiểm revision/hash và mã thao tác. Gửi lại cùng thao tác an toàn; cùng mã khác nội dung bị chặn.
- Đơn đã được nguồn ghi nhận thanh toán chỉ đổi hàng khi giữ nguyên tổng. Chênh lệch cần quy trình thu thêm/hoàn tiền riêng; sửa đơn không tạo hoặc hoàn tiền.
- Bản gốc, revision, người sửa, lý do và lịch sử trước/sau được lưu. Website gửi lại không ghi đè SKU/giá/tổng bản CRM; thay đổi nguồn khác bản đã đối chiếu được đánh dấu cần đối soát. Website gốc không tự được sửa sản phẩm/giá theo CRM trong PR này.
- Đơn cũ không có subtotal/thuế/giảm từng dòng từ nguồn hiện rõ thiếu chi tiết; không tự suy ra VAT hoặc giá gốc từ tổng thanh toán. Nhân viên phải xác minh khi lập bản sửa.

## Tạo GHN và kho

- Đơn Lock chưa sửa vẫn dùng cầu nối website hiện có. Đơn đã sửa gọi GHN bằng tài khoản đúng cửa hàng, lấy sản phẩm/COD từ bản CRM đã lưu; không để website tạo vận đơn theo giỏ cũ.
- Trước gọi ngoài, lưu ý định xác nhận bền vững và khoá sửa giỏ. Đơn chỉnh sửa ghi dấu lần tạo trước HTTP; sau mất phản hồi chỉ đối soát theo cùng client_order_code, không tự gọi Create lần nữa.
- Lock giữ client_order_code là số đơn website, giống cầu nối WordPress; Minh Long giữ quy ước `WEB-<số nguồn>`. Không đưa tên/mã CRM mới vào khoá GHN cũ.
- Nếu phục hồi được mã GHN sau lỗi ở bản sửa, giữ mã đó nhưng yêu cầu đối soát nội dung; chưa tự xuất kho theo bản sửa khi chưa xác minh. Không coi vận đơn tìm được là bằng chứng nó chứa SKU mới.
- Bấm xác nhận lặp trả mã đã có, không tạo thêm. Nhận mã thành công có link mở trang đơn trong CRM.
- Sổ kho tiếp tục dùng `ref_type=web_order`, cùng ID nguồn: GHN lấy hàng xuất đúng SKU/số lượng bản CRM, GHN hoàn về shop đảo đúng bút toán đã ghi. Hiển thị trong danh sách không tự ghi tồn hay nhân doanh thu.
- Khi kết quả GHN chưa rõ: giữ khoá sửa để kiểm tra website/GHN; không dùng SQL xoá dấu ý định hoặc đổi key để thử tạo lại. PR chưa có nút ép mở khoá cho nhân viên. Trường hợp xác nhận thất bại trước khi tạo thật vẫn cần người vận hành kiểm chứng trước khi giải phóng ý định; không tự nhận “đã lưu thành công”.

## Bản in

Chi tiết có In đơn hàng, Phiếu đóng gói, Phiếu giao hàng; dùng bản CRM hiện tại, cùng thứ tự dòng. Header Bách Ngân, lề trên 2 cm. Các bản phiếu là biểu mẫu theo số lượng đơn để soạn/giao, không tự lập packing slip/delivery hay xác nhận đã xuất/giao trong sổ kho. Trang đơn thường/HĐKT và các nút tiền/kho riêng vẫn giữ nguyên.

## Triển khai

1. Chủ doanh nghiệp chạy tay `migrations/postgres/20261102123212_web_order_crm_edit.sql` (thêm `crm_edit_snapshot`, `crm_order_no`; không viết lại dữ liệu tiền/kho cũ).
2. Kiểm tra `scripts/sql/assert-web-order-crm-edit.sql`, rồi deploy API/UI. Workflow deploy chỉ kiểm tra chỉ đọc, không tự chạy migration.
3. Kiểm tra một đơn mẫu được cho phép, xác nhận giỏ hiện trên CRM trùng giỏ tạo GHN. Không dùng đơn thật để thử nhiều lần.

Chưa chạy migration, merge hay triển khai production trong phiên triển khai này. Không sửa phiên/cron/đồng bộ Sapo.
