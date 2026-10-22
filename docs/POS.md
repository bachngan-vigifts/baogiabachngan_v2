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

Tiền mặt có tiền khách đưa/tiền thối và nút **Đủ tiền**. Chuyển khoản và VietQR đều yêu cầu nhân viên xác nhận cửa hàng đã thực nhận tiền. QR hết hạn sau 15 phút; giỏ/giá thay đổi phải tạo QR mới. SePay tự xác nhận khi tiền vào (xem mục "Xác nhận chuyển khoản SePay"). Giỏ đã được SePay xác nhận thì không thu lại bằng tiền mặt/COD/cọc; chọn Chuyển khoản sẽ tự gắn đúng khoản QR đó (kể cả khi tải lại trang mất mã QR).

**Thu tiền & in** lưu chứng từ trước khi mở in. Mất mạng hoặc mất phản hồi: dùng **Kiểm tra lại giao dịch** để lấy lại đúng đơn bằng mã chống lặp đã lưu trong sessionStorage, không thu lần nữa. Dữ liệu này không chứa token. **In lại bill** chỉ in snapshot đã lưu.

**In bill tạm** ghi rõ “BILL TẠM TÍNH - CHƯA THANH TOÁN”, không có số đơn chính thức, không tạo đơn, phiếu thu hay xuất kho. Bill tạm không lưu để tra cứu. In bằng trình duyệt, khổ 80mm; máy in phải được cài trên máy cửa hàng. Chưa có điều khiển ESC/POS trực tiếp.

## Kết ca và COD

Ca kết có snapshot cố định: số bill, giá trị bill, chiết khấu, tiền mặt, chuyển khoản và COD. Tiền két hệ thống = tiền đầu ca + tiền mặt thực thu + thu thủ công đã ghi − chi thủ công đã ghi. Phiếu chờ duyệt chặn kết ca. Mọi chênh lệch khác 0 cần chọn lý do (Khác cần ghi chú) và tự mở tra soát; kết ca gọi lặp chỉ có một kết quả. Báo cáo ca vẫn chỉ người mở ca và Manager được xem; NVBH cùng cửa hàng có thể xem/in lại bill trong ca được phép bán. Manager xem tất cả. Lịch sử giao diện hiển thị 50 ca gần nhất.

COD chưa thu không vào két. Cho kết ca khi còn COD chưa thu; danh sách tiếp tục theo cùng két của quầy sang ca sau, kể cả đổi nhân viên. Chỉ xác nhận thu sau khi chuyến đã giao và cửa hàng thực nhận tiền. Khoản thu gắn **ca đang mở lúc xác nhận**, không sửa báo cáo ca cũ. Thu COD bằng chuyển khoản không cộng tiền mặt. Báo cáo tách thu của chuyến giao trong ca, thu chuyến ca trước, và đã giao chưa thu.

POS không đẩy đơn sang Sapo, không sửa module lương/cron/phiên Sapo. Đổi / trả / hoàn tiền POS xem mục "Trả hàng · Đổi hàng · Hoàn tiền"; Manager/Kế toán được huỷ phiếu thu có lý do. Ca đã kết giữ báo cáo và mở lại tra soát; nhân viên có ca mới được ghi lại khoản thực nhận tại chi tiết đơn tại quầy mà không xuất hàng lần nữa. COD vẫn thu qua đúng chuyến giao.


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

## Phạm vi cửa hàng

NVBH LOCK và CHT LOCK chỉ truy cập quầy/két Lock; NVBH ML và CHT Minh Long chỉ truy cập quầy/két Minh Long. Server xác định cửa hàng từ chức vụ hệ thống hoặc tên chức vụ CHT, đối chiếu kho gắn với quầy (Lock được nhận diện trước vì tên kho có cả chữ Minh Long). Với tên kho chung chưa định danh, dùng tên quầy Lock/Minh Long. Không có quầy phù hợp thì không tự chuyển sang cửa hàng khác. Manager vẫn truy cập cả hai.

Danh sách POS, ca và Sổ quỹ chỉ trả quầy/két trong phạm vi. API từ chối truy cập chéo bằng registerId, drawerId, shiftId hoặc ID bill, QR, COD, phiếu/ảnh, tra soát; quyền duyệt được chỉ định không mở rộng cửa hàng. Đổi chức vụ có hiệu lực ở yêu cầu tiếp theo, kể cả ca cũ của chính nhân viên tại cửa hàng khác. Không thay đổi quyền của các chức vụ khác; không thêm bảng/cột/quyền/migration.
## Sửa đơn đã sinh từ POS

Manager mở chi tiết Đơn đặt hàng → **Sửa đơn POS**. Form chọn khách có sẵn hoặc sửa thông tin khách trên riêng đơn (không sửa hồ sơ khách gốc), địa chỉ/người nhận của chuyến chờ giao hoặc đang giao, và ghi chú điều kiện thanh toán. Mọi lần lưu cần lý do và revision; form cũ bị từ chối khi đơn đã đổi. Nhật ký ghi giá trị trước/sau.

Đơn COD chưa thu, chưa giao/xuất, chưa có phiếu đóng gói hay HĐKT, có tối đa một chuyến chờ giao toàn bộ hàng được sửa số lượng, giá niêm yết và CK trên các dòng hiện có. Giá nhập theo chính sách bill gốc (có VAT/không VAT), giữ thuế suất, server dùng posLine tính lại tiền; không nhận tổng từ client. Giao dịch kiểm tồn khả dụng trừ hàng giữ khác, cập nhật dòng hàng, snapshot bill, lịch thu, số tiền COD, số lượng chuyến giao và lịch sử sản phẩm. Không ghi xuất kho hoặc tạo phiếu thu khi sửa. Không đổi SKU/thêm/xoá dòng trong form này.

Đơn đã thu/xuất hàng vẫn sửa được thông tin liên hệ và ghi chú; không sửa lùi số lượng/giá trị hoặc chuyển khách liên kết khi còn phiếu thu hiệu lực. Phiếu thu sai dùng **Huỷ phiếu…** có lý do rồi ghi thu lại theo luồng hiện có; báo cáo ca đã chốt giữ nguyên. Chuyến đã giao giữ thông tin giao lịch sử.

Chi tiết đơn COD có nút **Thu COD** cho chuyến đã giao còn tiền chưa thu. Nút dùng lại `/pos/cod/:id/collect`, yêu cầu xác nhận thực nhận và ca đang mở đúng két, tiền mặt/chuyển khoản. Không mở cơ chế thu khác hay sửa trực tiếp phiếu thu. Ghi chú thanh toán không làm thay đổi trạng thái đã thu. Không thêm bảng/cột/quyền/migration.

## Chọn khách tại POS

Popup chọn khách dùng ô tìm kiếm có gợi ý theo tên/số điện thoại, không hiện sẵn danh bạ. Ba nút **Khách lẻ – Khách B2B – Khách mới** tách rõ: hai nút đầu lọc kết quả tìm theo phân loại khách đã có (`kind=retail`/`business`), nút cuối mở form tạo nhanh hiện tại. Khách B2B là nhóm không đánh dấu `is_retail`; không tự phân loại lại khách cũ. Nút Khách lẻ chỉ hiện theo quyền danh sách khách lẻ do server trả về. Bắt buộc chọn hồ sơ khách cụ thể trước khi thanh toán; đã bỏ lựa chọn **Khách vãng lai · Không lưu hồ sơ**. Hai bộ lọc Khách lẻ/B2B vẫn tìm hồ sơ có thật, không phải lựa chọn khách chung. Có thể dùng phím ↑/↓ và Enter để chọn gợi ý. Không đổi dữ liệu, schema hoặc quyền.

## Phí dịch vụ và phí ship

Trong giỏ có **+ Thêm khoản phí**: thêm được nhiều dòng (tối đa 50), mỗi dòng có tên tự nhập (ví dụ Phí in, Phí gói quà), số lượng nguyên từ 1, đơn giá VNĐ không âm và thành tiền. Nút Thêm khoản phí luôn hiện; Bỏ phí chỉ xoá đúng dòng được chọn. Ngay trên Tổng cộng có **Phí ship · Không VAT**. Phí dịch vụ theo bảng giá: giá lẻ + VAT là số khách trả đã gồm VAT theo quầy; giá lẻ không thêm VAT. Phí ship không tính VAT. Chiết khấu sản phẩm không áp dụng lên phí dịch vụ hoặc phí ship.

Server tính lại phí và tổng; tiền trước thuế gồm hàng sau CK, phí dịch vụ trước thuế và ship; tổng = tiền trước thuế + VAT. Lưu chi tiết `fees` trong `sales_orders.pos_snapshot` hiện có, và phí đầu vào trong canonical QR/request hash. Không thêm bảng/cột/migration/quyền. Bill cũ không phí giữ input hash cũ; phí đổi không được dùng QR cũ hay replay checkoutKey cũ.

Bill tạm/K80 và bản in/Excel đơn có tách phí. Chi tiết đơn có dòng phí riêng bằng DOM text; phí không phải SKU, không thêm số lượng vào kho/giao hàng và không tạo phát sinh tồn. Khoản thu, công nợ, COD, báo cáo ca lấy tổng đã gồm phí. COD chưa thu vẫn không vào két. Manager đổi SL/giá đơn COD giữ phí gốc, cập nhật đồng thời lịch thu và COD chuyến giao. Sau bán xong/huỷ giỏ/đổi tài khoản, danh sách phí và phí ship trở về trống.

API mới nhận `serviceFees: [{ name, quantity, unitPrice }]` cùng `shippingFee`; giữ đầu vào một phí cũ `feeName/feeQuantity/feeAmount` để QR/request hash cũ không đổi. Không nhận đồng thời hai định dạng phí. Mỗi dòng tính VAT/làm tròn bằng `posLine` theo bảng giá rồi cộng tổng, không gộp trước khi tính VAT. Snapshot có `fees.services` chi tiết và `fees.service` tổng tương thích cho luồng đổi/trả/hoàn; bill cũ không có danh sách vẫn đọc đúng. Bill tạm/K80, chi tiết và bản in/Excel đơn hiển thị riêng từng khoản.

Payload POS → n8n/Claw bổ sung `additional_fees` (dịch vụ gồm amount/subtotal/tax_amount/tax_percent; ship amount/tax_percent=0), giữ tổng đã gồm phí và diễn giải từng dòng trong notes. `additional_fees.service` giữ tổng tương thích, thêm `service.lines` để lưu tên, SL, đơn giá và tiền/thuế từng khoản; không cộng tổng và lines hai lần. Đã kiểm payload bằng adapter giả; cần kiểm dry-run downstream n8n/Claw trước khi kết luận khoản phí đã được ghi đúng ở Sapo. Không kiểm thử bằng đơn thật.

Cụm **Đơn hàng cửa hàng** nằm cuối trang, sau danh mục sản phẩm và thanh toán; giữ bộ lọc, liên kết và nguồn đồng bộ hiện có. Đơn website (`web_store_orders`): xem thông tin, **chọn địa chỉ chuẩn GHN → kiểm tra → tạo vận đơn**, cập nhật trạng thái hoặc huỷ (gọi về website nguồn); không tự tạo bản sao đơn bán CRM khi bấm xem.
## Voucher trên đơn (22/10/2026)

Giỏ hàng có mục **Voucher**, nằm ngay trên phần phí. Thu ngân nhập tay, không có danh sách mã phát hành sẵn.
- **Nhập:** mã / ghi chú voucher (bắt buộc, tối đa 60 ký tự, ví dụ `VC-TET2026` hoặc "voucher KH thân thiết") + số giảm theo **VNĐ** hoặc **%**. Nút **Bỏ voucher** xoá cả mục.
- **Cách tính (máy chủ, `pos-money.ts` › `parsePosVoucher` / `allocatePosVoucher`):**
  - giảm cho **cả đơn**, tính trên tiền hàng **sau** chiết khấu từng dòng;
  - trừ **thẳng vào giá đã gồm VAT** (theo yêu cầu 22/10/2026), rồi tách lại VAT trên số sau giảm. Ví dụ hàng 185.000 đ (gồm VAT 8%), voucher 20.000 đ → khách trả 165.000 đ, VAT 12.222 đ. Bảng giá không VAT thì trừ thẳng vào giá;
  - chia vào các dòng theo tỷ lệ tiền hàng, phần lẻ dồn cho dòng có phần dư lớn nhất;
  - không áp vào phí dịch vụ, phí ship;
  - không được vượt tiền hàng (400 "Voucher vượt tiền hàng của đơn"); % trong 0–100.
- **Theo chính sách POS đã chốt** (mục Ngoại lệ phê duyệt): không có bước duyệt; bắt buộc ghi mã để đối soát.
- **Lưu ở đâu:**
  - `posSnapshot.voucher` = { code, type, value, amount };
  - mỗi dòng: `discountAmount` = CK dòng + phần voucher (`voucherAmount` trong snapshot). `discountType` / `discountValue` vẫn là CK dòng;
  - voucher nằm trong giỏ chuẩn hoá (`canonical`), nên đổi voucher thì QR cũ không dùng được.
- **Hiện ở:**
  - tổng giỏ: Giảm giá (CK dòng) + dòng "Voucher <mã>";
  - bill K80: dòng "Voucher (chia theo dòng)" từng món + tổng voucher;
  - chi tiết đơn: ô "Voucher";
  - ghi chú gửi Sapo;
  - báo cáo ca: ô Chiết khấu (gồm CK dòng + voucher).
- **Sửa đơn COD chưa xuất:** voucher chia lại theo số lượng / giá mới. % giữ tỷ lệ, VNĐ giữ số tiền (không vượt tiền hàng mới).
- **Sửa kèm:** báo cáo ca trước đây luôn ra Chiết khấu 0 (truy vấn con hiểu nhầm cột `id`); nay tính đúng.
- **Test:** `tests/app/pos-voucher.test.ts`, `src/modules/sales/domain/pos-money.test.ts`, `tests/app/pos-ui.test.ts` (giao diện + bill).

## Xác nhận chuyển khoản SePay trên giỏ hàng

Nút đổi khách ở giỏ hàng dùng màu xanh lá cùng nút Mở ca, rộng tối thiểu 170px trên máy tính và 150px trên điện thoại, cao 44px. Khi dùng **Hiện QR**, POS theo dõi yêu cầu thanh toán hiện tại kể cả sau khi đóng popup. Server báo đã nhận đủ tiền đúng QR thì ô chuyển khoản tự tích, hiện xác nhận SePay và bật **Thu tiền & in** để nhân viên hoàn tất. Nút này gửi đúng paymentRequestId để giữ liên kết với khoản chuyển tiền. Kết nối SePay hoặc tạo QR chưa được tính là đã nhận tiền; webhook vẫn đối chiếu mã/tài khoản/số tiền tại server. Thay đổi giỏ/bảng giá/khách hoặc tài khoản đăng nhập làm mất hiệu lực xác nhận cũ. Giữ lựa chọn xác nhận thủ công khi cửa hàng đã kiểm tra thực nhận.

## Ghi chú đơn hàng

Ngay dưới hướng dẫn phí dịch vụ có ô **Ghi chú đơn hàng** (tối đa 2.000 ký tự). Ghi chú lưu trên đơn và snapshot, hiện trong bill tạm/K80/chi tiết đơn và ghi chú payload outbound. Nhập ghi chú không thay số tiền hoặc mất xác nhận QR. Gửi lại cùng checkoutKey phải giữ ghi chú như lần đầu; đổi ghi chú sau hoàn tất dùng luồng sửa đơn có kiểm quyền/audit. Không thêm migration hoặc quyền.

Luồng đổi/trả/hoàn tiền và schema đã duyệt được mô tả tại [POS-RETURNS-PREFLIGHT.md](POS-RETURNS-PREFLIGHT.md). Cần áp dụng hai migration mới trước khi triển khai API này lên live.

## Trả hàng, đổi hàng, hoàn tiền

Vào **Trả / Đổi / Hoàn** trên POS hoặc **Trả / Đổi / Hoàn tiền** trong chi tiết bill POS. Người được chỉ định duyệt nhưng không có quyền bán vào **Sổ quỹ → Duyệt đổi / trả hàng**; quyền duyệt không cấp quyền nhận hàng/hoàn tiền. Tìm bill gốc, chọn SL đã giao cần trả và tình trạng hàng, nhập lý do rồi gửi duyệt. Manager/người được chỉ định duyệt; người được chỉ định không tự duyệt, Manager được tự duyệt có audit. Mặc định hoàn hàng; phí dịch vụ/ship chỉ hoàn thêm khi Manager duyệt.

Sau duyệt, nhân viên có ca mở tại đúng quầy xác nhận **thực nhận hàng**. Hàng bán được tăng tồn, hàng hỏng không tăng tồn bán. Giá/CK/VAT lấy bill gốc. Xác nhận **đã hoàn tiền** chỉ khi cửa hàng thực trả: tiền mặt trừ két ca hiện tại, chuyển khoản cần tham chiếu và không vào két. COD chưa thu chỉ giảm công nợ, không phát sinh tiền hoàn.

Đổi hàng: thêm hàng mới vào giỏ, mở phiếu trả đã thực nhận, chọn **Dùng tiền trả để đổi hàng**. Bill mới chỉ thu thêm chênh lệch; phần dư hoàn riêng nếu khách đổi hàng rẻ hơn. Tín dụng gắn cùng khách/quầy/nhân viên, giữ 15 phút; QR còn hiệu lực hoặc đã nhận tiền giữ khoản này để chống dùng/hoàn trùng. Bill cũ và báo cáo ca cũ giữ nguyên, báo cáo ca hiện tại tách hàng trả/tiền thực hoàn/tín dụng đổi hàng.

Không dùng huỷ phiếu thu để giả lập trả hàng. Phiếu hoàn thực tế không được huỷ như phiếu ghi nhầm; bản này chưa có màn đảo chứng từ hoàn. Không tự sửa Sapo, hoá đơn VAT đã phát hành hoặc chuyển tiền qua ngân hàng.

### Thu trước khi tạo đơn giao COD

Form Giao Ship COD hiển thị tổng đơn, đã thu trước/tạm ứng, hình thức thu và còn lại thu COD. Số tiền thu trước là số nguyên VNĐ từ 0 đến tổng đơn; server tính lại từ giỏ, không tin tổng/còn lại do client gửi. Chuyển khoản cần xác nhận thực nhận; phần này xác nhận thủ công, không tự coi kết nối SePay là đã nhận tiền. Không thay luồng QR thanh toán toàn bộ giỏ.

Tạo đơn và phiếu thu trước trong cùng giao dịch, cùng khoá chống lặp. Phiếu thu (`payment_source=pos_cod_deposit`) thuộc ca đang mở; tiền mặt vào két, chuyển khoản không vào két. Tổng công nợ ban đầu giữ toàn bộ giá trị đơn, phần đã thu là phiếu thu, chuyến giao chỉ thu COD phần còn lại. Được thu đủ trước khi giao (COD còn 0). Bản in K80 tách tổng/đã thu/còn lại. Chưa giao vẫn giữ hàng theo luồng COD cũ.

Huỷ phiếu thu trước ghi nhầm vẫn cần quyền/lý do, không phải hoàn tiền; phần đã huỷ được trả lại số phải thu của chuyến giao gốc. Ca đã kết giữ báo cáo và tra soát như trước. Không sửa tự động bill cũ hoặc phát sinh giao dịch ngân hàng/Sapo. Không thêm bảng, cột, quyền hoặc migration.

## Đặt cọc nhận sau và ship trả trước 100%

> **Đã ngừng tạo mới (21/10/2026).** Màn Thanh toán không còn hai lựa chọn này; API tạo mới trả 410 `POS_ORDER_FLOW_DISABLED`. Đơn cọc / trả trước đã có vẫn xử lý đủ bên dưới (thu nốt, nhận hàng, huỷ, trả hàng).

Trong menu **⋯ → Đơn cọc đang xử lý** xem lại đơn; chi tiết đơn cũng có nút **Cọc / Thu nốt / Trả trước**. Nhân viên có quyền POS cùng cửa hàng xem và tiếp nhận đơn qua ca khác; quyền sở hữu/chia sẻ khách hàng không mở được đơn cửa hàng đối diện, kể cả ở màn đơn/giao/đóng gói chung. Giá, số lượng và CK của đơn giữ nguyên. Hai luồng độc lập với bán tại quầy và COD hiện có.

Cọc mặc định 30%, có nút 50% và ô số khác >0 đến tổng đơn. Hàng giữ 5 ngày; hết hạn chỉ nhả giữ, không tự huỷ đơn/hoàn tiền. **Kiểm tra tồn và giữ lại hàng** trước khi thu nốt sau hết hạn. Thu nốt và giao tại quầy thực hiện cùng transaction; thiếu hàng/tiền thì không xuất. Được thu nốt trước rồi nhận hàng sau; nút nhận hàng khi đã đủ tiền không tạo phiếu thu 0đ.

Ship trả trước yêu cầu đủ 100%, nhập người nhận, điện thoại, địa chỉ và ngày giao. Chuyển khoản đang chờ giữ hàng 5 ngày nhưng không cho đóng gói/xuất/giao. Đã nhận đủ thì giữ đến lúc xuất hoặc xử lý huỷ; đóng gói từ đúng kho quầy, chuyến giao COD 0. Đóng gói đã ghi xuất thì giao không xuất lần thứ hai. Kho thiếu tồn thực tế thì chặn xuất.

Chọn chuyển khoản mà chưa đánh dấu thực nhận chỉ tạo `pos_payment_intents`; chưa có phiếu thu, không vào két. Vào đơn, kiểm tra thực nhận, nhập mã tham chiếu rồi xác nhận. Phiếu thu thuộc **ca đang mở lúc xác nhận**, có thể khác ca lập đơn nhưng phải cùng quầy/két. Nếu ngân hàng thực nhận sau khi giữ đã hết hạn và hàng đã bán, vẫn ghi đúng khoản thực nhận, báo cần giữ lại hàng và chặn xuất; không giả lập đã giữ đủ. Chức năng này xác nhận thủ công, không tự suy ra đã nhận tiền chỉ vì kết nối SePay.

**Huỷ trước xuất** giải phóng giữ, huỷ các khoản chờ và lập đề nghị hoàn toàn bộ tiền đã nhận hoặc tín dụng đổi hàng. Manager/người chỉ định duyệt theo cơ chế đổi/trả; duyệt không chi tiền. Ngữ cảnh `before_fulfillment` không có bước nhập lại hàng. Giá trị giảm công nợ là toàn đơn nhưng tiền được hoàn không vượt thực thu còn hiệu lực sau các hoàn/tín dụng đã dùng. Yêu cầu bị từ chối/huỷ có thể lập lại từ đơn đã huỷ.

**Đã đóng gói/xuất nhưng chưa giao**: dùng **Trả / Đổi / Hoàn**, thu hồi toàn bộ hàng đã xuất của đơn; không huỷ thẳng. Sau duyệt, dừng giao đơn và nhả phần chưa xuất; phải xác nhận thực nhận lại hàng mới nhập tồn và cho hoàn/đổi. Phần chưa xuất chỉ giảm công nợ, không tạo nhập kho giả. Mặc định hoàn tiền hàng, hoàn thêm phí chỉ Manager duyệt. Sau khi đã giao dùng nghiệp vụ trả hàng hiện có theo số lượng đã giao.

Báo cáo tách cọc thực nhận, thu nốt, trả trước, chuyển khoản chờ và đơn còn phải thu cùng két. Tiền mặt thực thu vào két ca thực nhận; chuyển khoản không vào két. Đơn chưa tất toán không chặn kết ca; báo cáo ca đã kết không đổi. Huỷ phiếu thu ghi nhầm không tự mở lại intent hay gia hạn giữ đã hết hạn; hàng đã xuất dùng trả/hoàn thay vì huỷ phiếu thu.

Giao diện chỉ mở lựa chọn mới khi `/pos/options.orderFlowVersion >= 1` và gửi tạo đơn qua `/pos/order-flows/checkout` riêng; API cũ/rollback trả lỗi thay vì coi cọc là bán đã thanh toán đủ. Bán tại quầy/COD vẫn dùng `/pos/checkout`.

Dữ liệu được duyệt ngày 20/10/2026: `20261020010950_pos_deposit_prepaid.sql` và `20261020011018_supabase_access_pos_deposit_prepaid.sql` — hai bảng và `pos_returns.request_context`, RLS server-only. (Đã triển khai cùng API/UI; kiểm tra lại trên DB nếu nghi ngờ thiếu bảng.) Không tạo giao dịch ngân hàng hay tự đồng bộ hai luồng mới sang Sapo/Claw trong thay đổi này. Không thay chính sách giảm giá/khách POS, lương hay cron.


## Ca bán hàng dùng chung trong cửa hàng

Khi một ca quầy đang mở, mọi nhân viên có `pos.sell` và chức vụ NVBH/CHT thuộc cùng cửa hàng được bán/thu tiền trên ca đó: Lock chỉ dùng ca thuộc Lock; Minh Long chỉ dùng ca Minh Long. Nhận diện theo id/tên chức vụ và quầy/kho như ranh giới cửa hàng hiện có, không dựa tên nhân viên. Vai trò không gán cửa hàng không tự có quyền dùng ca người khác; Manager giữ quyền xem/đóng ca hiện có, không tự nhận quyền bán trong ca người khác.

- `GET /pos/options` ưu tiên ca đang mở do chính người dùng mở, sau đó ca đang mở cùng cửa hàng (ưu tiên quầy mặc định). Không bị giới hạn bởi danh sách 50 ca lịch sử. Ca dùng chung chỉ trả định danh/người mở/mốc ca cần bán, không trả tiền đầu ca hoặc báo cáo ca; `canCloseCurrent` chỉ bật cho người mở.
- Nếu đồng nghiệp mở ca sau khi màn hình đã tải, bấm **Mở ca** kiểm tra lại options và dùng ca hiện có, không tạo ca mới hay ghi số thực đếm giả.
- API bán/preview/QR/theo dõi QR/COD/thu cọc/trả trước và thao tác đổi/trả dùng `saleShiftOf` kiểm cửa hàng tại server. Ca đã kết không được ghi thêm giao dịch; idempotent replay giữ chứng từ cũ. Khoá ca/két và kho giữ cơ chế giao dịch hiện có để bán đồng thời không ghi trùng/trừ âm.
- Đơn, bill snapshot, phiếu thu và nhật ký ghi **người thực sự bán/thu** (`owner_id`/`created_by`), đồng thời `shift_id` là ca chung. Người mở ca không bị đổi; báo cáo tổng ca/két cộng các giao dịch chung, doanh số cá nhân vẫn theo người bán.
- Người dùng ca chung không có nút **Kết ca**; API kết ca POS và Sổ quỹ vẫn kiểm người mở ca. Không mở rộng quyền sửa két, duyệt, xem lịch sử/báo cáo của người khác.

Không schema/migration/quyền mới; không tự chuyển cửa hàng hoặc tạo phiếu thu/đơn thật trong kiểm thử.

### Tiền đơn website

Webhook WooCommerce lưu các mã giảm giá, phí âm đổi điểm, phí ship thu khách/phương thức, thuế và tổng nguồn trong web_store_orders.financial_snapshot. POS, việc xuất hoá đơn và chi tiết Kế toán hiển thị từ snapshot; không tính lại total, không trừ điểm thêm lần nữa. ghnFee là phí hãng GHN riêng. Bản ghi cũ `{}` hiện chưa đồng bộ chi tiết; cần website gửi lại đơn để có dữ liệu, không suy ngược từ total. Cập nhật chỉ trạng thái giữ chi tiết đã có. Hợp đồng nguồn và migration: WEB-ORDER-ADJUSTMENTS-PREFLIGHT.md.


### Khách hàng bắt buộc khi thanh toán (21/10/2026)

Giỏ được thêm/xem giá trước khi chọn khách. Tiền mặt, chuyển khoản/QR, COD và cọc/trả trước phải chọn hoặc tạo khách đã duyệt. API checkout và tạo QR kiểm lại điều kiện, trả 400 `POS_CUSTOMER_REQUIRED` nếu chưa có khách hoặc hồ sơ tên chung Khách lẻ/Khách vãng lai. Tạo khách mới ngay trong POS cũng từ chối các tên chung này. Không bắt buộc sửa đơn cũ; replay giao dịch đã lưu vẫn trả lại đúng đơn cũ và không tạo thêm. Không đổi schema, tổng tiền hoặc quyền.

## Báo cáo ca dạng khối (21/10/2026)
Popup Báo cáo ca (Bán hàng nhanh), Sổ quỹ › Xem ca và hộp **Kết ca** dùng chung `trial-ui/shift-report-view.js`; cùng số liệu với bản in K80.
- Ô tổng: Số bill (kèm giá trị đơn đã lập), **Tiền thực thu** = tiền mặt + chuyển khoản (đã gồm COD, cọc đã thu – không cộng COD lần nữa), Tiền mặt vào két, Chiết khấu.
- **Dòng tiền két**: đầu ca + tiền mặt bán hàng + COD tiền mặt + thu tay − chi tay = két hệ thống (số két lấy của máy chủ; phần khác nếu có hiện dòng "Khác").
- Tiền thu theo cách thu (thanh tỷ lệ), phiếu thu/chi tay từng dòng (giờ, loại, nội dung, trạng thái), Ship COD + đơn cọc, trả hàng (khi có), tra soát đầu ca (tách riêng), quy tắc đang áp dụng. Bấm khối → trang liên quan.
- **Kết ca**: cột phải (điện thoại: lên đầu) – ô tổng tiền đếm, nút cộng nhanh +500k…+10k / Xoá; chênh lệch 3 trạng thái: chưa đếm (xám, nút khoá) · khớp (xanh) · lệch (cam, bắt buộc lý do, "Khác" bắt buộc ghi chú). Còn phiếu chờ duyệt: banner chặn + "Xem phiếu". "Xem trước bản in" in K80 với số đang đếm (chưa kết).
- Không đổi công thức két, COD, tra soát, quyền xem báo cáo, chống ghi lặp. Báo cáo máy chủ thêm `entries` (phiếu thu/chi của ca); báo cáo ca cũ đã chốt không có thì gộp theo loại.

## Form sau bảng Thanh toán: chống bấm trùng và giao diện mới (21/10/2026)
- **Đang xử lý:** khi đang gửi đơn, nút chính đổi sang "Đang lưu đơn & in bill…", "Đang tạo đơn COD…", "Đang ghi nhận…" hoặc "Đang tạo mã QR…", có vòng quay. Trong lúc đó cả form bị khoá (nút, ô nhập, nút ×, phím Esc) nên không bấm lần hai và không đóng giữa chừng được.
- **Ship COD:** form chia ba bước: Thông tin giao → Kiểm tra lại → Tạo đơn COD.
  - Các khối Người nhận, Địa chỉ GHN, Thu trước có bảng tổng hợp: Tổng đơn, Đã thu trước, Còn thu khi giao.
  - Bước kiểm tra hiện bản tóm tắt chỉ đọc, kèm nút "Sửa thông tin".
  - Phải nhập đủ người nhận, điện thoại, số nhà và chọn đủ Tỉnh/Quận/Phường mới sang được bước kiểm tra.
- **Đặt cọc / Ship trả trước:** cùng khung với bảng Thanh toán.
  - Có nút nhanh 30%, 50%, Thu đủ và bảng tổng hợp: Tổng đơn, Thu lần này, Còn lại.
  - Riêng ship trả trước bắt buộc nhập người nhận, điện thoại và địa chỉ.
- **VietQR:** khung mới có số tiền lớn, mã QR, nội dung chuyển khoản và chấm trạng thái "Đang chờ SePay…" / "Đã xác nhận".
- **Kết quả gửi đơn:**
  - Lưu được: đóng form, hiện "Đã lưu đơn hàng".
  - Máy chủ từ chối (lỗi 4xx): **giữ nguyên form và dữ liệu đã nhập**, báo lỗi ở đầu form để sửa rồi gửi lại. Trước đây form đóng ngay khi bấm nên mất dữ liệu.
  - Mất kết nối, chưa rõ kết quả: đóng form, giữ giao dịch chờ "Kiểm tra lại giao dịch".
- **Quay lại thanh toán:** form COD (và form cọc/trả trước khi được mở từ bảng Thanh toán) có nút này để mở lại bảng Thanh toán mà không mất giỏ.
- Không đổi API, công thức tiền hay quyền. Không cần migration.

## Soát trang Bán hàng nhanh (21/10/2026)
**Việc tự sinh mới (trang Công việc, tự hoàn thành theo chứng từ):**
- `pos-intent:` chuyển khoản cọc / trả trước đang chờ xác nhận → người phụ trách đơn, hạn trong ngày.
- `pos-hold:` đơn cọc còn ≤ 1 ngày hoặc vừa hết (≤ 7 ngày) hạn giữ hàng → người phụ trách liên hệ khách.
- `pos-cod:` Ship COD đã giao ≥ 2 ngày chưa ghi thu đủ (bỏ qua đơn đang có yêu cầu trả hàng) → người phụ trách đơn.

Việc tự sinh chỉ được tính lại khi có người mở trang Công việc (không có cron).

**Thông báo:**
- Yêu cầu đổi / trả hàng mới báo người duyệt két của đúng cửa hàng; bấm thông báo mở thẳng yêu cầu của bill (`#/cash?returnOrderId=`).
- Lệch tiền **đầu ca** (trước đây chỉ lặng lẽ tạo tra soát) và **cuối ca** báo người duyệt két của đúng cửa hàng, gồm cả CHT được chỉ định; trước đây chỉ báo Manager. Bấm thông báo mở Sổ quỹ của két.

**Dữ liệu:**
- Đơn cọc / trả trước tạo xong đồng bộ ngay việc xuất hoá đơn.
- Cập nhật đơn web không còn xoá trạng thái GHN khi website không gửi trạng thái.
- Huỷ đơn cọc chưa xuất hàng đóng cả chuyến giao thất bại.

## Quyết định 21/10/2026 (sau khi soát)
- **Bỏ tạo đơn cọc / ship trả trước.** Giao diện không còn nơi tạo. API trả 410 `POS_ORDER_FLOW_DISABLED`. Đơn cũ vẫn xử lý trong menu **⋯ → Đơn cọc đang xử lý**.
- **Chỉ bán tại quầy được giao.** Máy chủ chặn mở ca, xem danh mục/tồn, đếm đầu ca và xử lý trả hàng ở quầy khác (403 `POS_REGISTER_NOT_ALLOWED`).
  - Manager và người có quyền cấu hình POS: mọi quầy.
  - NVBH / CHT Lock, Minh Long: quầy của cửa hàng mình.
  - Nhân viên khác: chỉ quầy đang mở ca của mình. Nếu không có ca đang mở thì không bán được, kể cả Sale / Sale Admin.
  - Người duyệt vẫn xem mọi yêu cầu trả hàng để duyệt.
- **Thông báo mỗi bill cho Manager:** giữ nguyên, không gom.
- **Xác nhận "đã nhận" chuyển khoản QR bằng tay:** giữ nguyên, dùng khi SePay chậm.
- **Tốc độ:**
  - Bảng đơn cửa hàng lọc trong SQL. Chưa chọn ngày thì đơn đã xong chỉ lấy 30 ngày gần nhất; đơn dang dở luôn hiện. Danh sách 100 đơn/trang, tổng tiền tính trên toàn bộ kết quả lọc.
  - Báo cáo ca và Ship COD tính số còn phải thu bằng truy vấn gộp.
- **Webhook SePay / WooCommerce không còn mã dự phòng trong code.** Cần 3 secret GitHub: `SEPAY_POS_API_KEY_HASH`, `WOO_LOCK_TOKEN_HASH`, `WOO_MINHLONG_TOKEN_HASH` (SHA-256 hex). Thiếu secret thì bước deploy API dừng lại, không triển khai.

## Đồng bộ trạng thái GHN (shop Lock) ngay trong CRM
- Mở **Ship COD** ở Bán hàng nhanh là CRM tự đồng bộ; có nút **↻ Đồng bộ GHN** để chạy lại. API `POST /pos/ghn/sync` (cần quyền bán hàng nhanh, kiểm ở máy chủ); bấm liên tục trong 60 giây dùng lại kết quả cũ, không gọi GHN lại.
- Đồng bộ các chuyến COD của quầy Lock có mã vận đơn và chưa xong: GHN đã lấy hàng → *đang giao* + xuất kho một lần; GHN giao xong → *đã giao* + ghi thu COD (nguồn `ghn_cod`, không cộng vào két); hoàn / huỷ → *thất bại*.
- Máy ngoài (n8n / OpenClaw) vẫn gọi được `POST /integrations/ghn/pos-lock/pull` bằng mã đồng bộ.
- **Tự tạo vận đơn GHN (22/10/2026, quầy Lock – shop GHN 6096731):** bấm **"Xác nhận, tạo đơn COD & vận đơn GHN"** → CRM lưu đơn rồi gọi GHN `shipping-order/create` (`pos-ghn-create.ts`), gắn mã vận đơn vào chuyến giao → trạng thái tự đồng bộ về như trên.
  - Form COD (quầy Lock) có thêm: **Khối lượng (gram, mặc định 500)**, **Khi giao** (mặc định *Cho xem hàng, không cho thử*; hoặc Cho thử / Không cho xem), **Ghi chú cho shipper**. Bắt buộc chọn đủ Tỉnh / Quận / Phường GHN; số điện thoại 10 số.
  - **Phí ship nhập tay** ở ô "Phí ship · Không VAT" của giỏ: 0 = free ship; có số = thu khách (đã cộng vào tiền COD). GHN luôn tính phí vận chuyển cho shop (`payment_type_id = 1`), thu hộ đúng "Còn lại thu khi giao". Giá khai báo từng món = đơn giá đã gồm VAT; không mua bảo hiểm (`insurance_value = 0`).
  - GHN lỗi (sai SĐT, địa chỉ…): **đơn vẫn lưu**, popup báo lý do + nút **Tạo lại vận đơn GHN**; danh sách **Ship COD** hiện mã vận đơn / trạng thái, chuyến chưa có mã có nút **Tạo vận đơn GHN** (`POST /pos/cod/:deliveryId/ghn`). Một lần: khoá chuyến trong lúc gọi GHN, đã có mã thì trả mã cũ, `client_order_code` = số đơn CRM.
  - Đã nhập **mã vận đơn tay** thì không tự tạo. Quầy khác (Minh Long) vẫn tạo trên trang GHN rồi nhập mã.
  - **Huỷ đơn / huỷ chuyến giao** trong CRM → tự huỷ vận đơn GHN (`switch-status/cancel`, `pos-ghn-cancel.ts`). GHN từ chối (đã lấy hàng…) thì CRM vẫn huỷ, thông báo lý do để huỷ trên trang GHN.
  - Đã có vận đơn GHN thì **không sửa số lượng / giá / người nhận / địa chỉ** ở CRM (409 `GHN_SHIPMENT_EXISTS`) vì GHN vẫn giữ số cũ.
  - Danh mục địa chỉ: có `GHN_API_TOKEN` thì lấy thẳng từ GHN khi bản đóng gói sẵn thiếu (trước đây đòi `WEB_ORDER_ACTION_TOKEN` nên báo "Chưa cấu hình kết nối GHN").
  - Đồng bộ trạng thái: lỗi kèm **số đơn**; mỗi lượt 100 chuyến, chuyến lâu chưa kiểm trước (không bỏ sót).
  - Lưu ở `posSnapshot.ghn` (quận / phường / khối lượng / cách xem hàng / mã / phí GHN) – không cần migration. Test: `tests/app/pos-ghn-create.test.ts`.
- Cần secret **`GHN_API_TOKEN`** (token API của tài khoản GHN shop Lock, ShopId 6096731) trên GitHub → workflow "Triển khai API" đặt vào Supabase. Chưa có token thì CRM báo "CRM chưa có token GHN".

## Thẻ "Đơn web" trên bảng đơn cửa hàng (22/10/2026)
- Bảng **Đơn hàng cửa hàng** có thêm thẻ **Đơn web**, nằm cùng hàng với Tất cả đơn / Chờ xử lý / Đang đóng hàng / Đợi giao / Hoàn thành / Đã hủy.
  - Số trên thẻ là số đơn website còn cần xử lý (chưa hoàn thành, chưa huỷ).
  - Có đơn thì số **đỏ nhấp nháy**. Máy tắt hiệu ứng chuyển động thì chỉ đỏ, không nháy.
  - Bấm thẻ để lọc riêng các đơn này: `GET /pos/orders?status=web`, `counts.web` (`pos-order-board.ts`).
- Bấm vào đơn web: ngoài "Chọn địa chỉ & tạo vận đơn GHN" và "Cập nhật trạng thái", có thêm:
  - **Hoàn thành**: hỏi xác nhận → `POST /pos/web-orders/:id/action { action: 'complete' }`. Website trả về không kèm trạng thái thì CRM ghi "Hoàn thành".
  - **Huỷ đơn**: form **bắt buộc lý do** (≥ 3 ký tự; thiếu → 400 `reason_required`) → `{ action: 'cancel', reason }`. Lý do và tên người huỷ gửi sang website, ghi vào nhật ký `web-order-cancel`.
- **Cần plugin trên website** (cầu nối `order-action-v7`, secret `WEB_ORDER_ACTION_TOKEN`) hiểu thao tác `complete` (chuyển đơn WooCommerce sang Hoàn thành) và trường `reason` khi huỷ. Plugin chưa hỗ trợ thì nút báo đúng lỗi website trả về; đơn trong CRM không đổi.
- Test: `tests/app/pos.test.ts` (máy chủ), `tests/app/pos-ui.test.ts` (thẻ, form huỷ).
