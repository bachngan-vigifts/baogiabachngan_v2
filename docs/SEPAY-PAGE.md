# Trang ghi nhận thanh toán SePay

## Quyền và phạm vi

Mở **Tiền & công nợ → Thanh toán SePay** (`#/sepay`); điện thoại vào nhóm **Tiền** ở menu chân trang. Manager và Kế toán được xem danh sách, chứng từ gốc và lịch sử xử lý. Chỉ Manager được tìm đơn/HĐKT, xem trước cách ghi nhận và xác nhận. API kiểm tra quyền độc lập với giao diện.

Trang hiển thị giao dịch tiền vào đã được webhook CRM hoặc thao tác tải API lưu trong `sepay_transactions`. Trang không tải sao kê lịch sử trực tiếp từ ngân hàng. Dùng migration và cấu hình tài khoản đã có trong [luồng nhận webhook](SEPAY-RECEIPTS.md); các thay đổi đối soát theo tiền/thời gian cần migration mới bên dưới; không tự cấu hình webhook.

## Tự đối soát POS/web theo số tiền và thời gian

- Ưu tiên mã chứng từ rõ ràng theo quy trình hiện có. Khi thiếu mã, tìm **đơn POS hoặc web** trong **5 phút trước đến 5 phút sau thời điểm giao dịch ngân hàng** (`transactionAt`, không dùng giờ mở màn hình hoặc giờ import). Số tiền phải khớp chính xác VND; không làm tròn, không dung sai. CRM/HĐKT không được tự gán theo số tiền/thời gian.
- Chỉ khớp tự động khi có **một** đích/phiếu thu phù hợp. Có nhiều đích cùng tiền, kể cả một đích gần hơn, giữ để Manager chọn. Chạm giới hạn 50 đơn mỗi nguồn cũng không chọn đại từ một danh sách bị cắt.
- Với khớp theo tiền/thời gian, chờ hết 5 phút phía sau để xét đơn tạo sau. Webhook lưu chứng từ ngay. Lịch SePay 5 phút sẵn có thử lại các dòng đã hết cửa sổ, trong 15 phút gần nhất, tối đa 30 dòng/lượt; không thêm cron/timer hoặc request vào trang POS. Nhịp `/pulse` hiện có nhận dấu nhật ký mới qua index `audit_logs.created_at`, để các trang đang mở kiểm tra lại dữ liệu; không thêm polling. Vì có nhịp lịch, trạng thái có thể cập nhật ở lượt tiếp theo, thường 5–10 phút sau giao dịch. Giao dịch cũ hơn phạm vi thử lại vẫn giữ trong sổ để xử lý thủ công; không backfill hàng loạt lịch sử.
- **POS:** gắn vào phiếu chuyển khoản chưa bị huỷ và chưa gắn SePay khác, cùng số tiền và quầy/tài khoản. Giữ nguyên phiếu, ca, ngày thu và sổ quỹ, kể cả ca đã đóng. Phiếu trước nửa đêm và ngân hàng sau nửa đêm được xét theo thời điểm, không ép cùng ngày. POS chưa có phiếu chuyển khoản phải hoàn tất thu trong POS trước; không tự đổi đơn COD, cập nhật tiền hãng vận chuyển hoặc tạo thêm tiền vào ca.
- **Web Lock/Minh Long:** đúng tổng đơn VND, đúng tài khoản quầy đang hoạt động, phương thức chuyển khoản/QR và nguồn không huỷ/hoàn/xung đột/sửa giá. Chứng từ SePay đã xác thực là bằng chứng thu riêng; CRM đọc bằng chứng này để hiển thị đã trả tiền. Không ghi `date_paid` giả, không sửa `financial_snapshot` gốc, không gọi Woo payment_complete, không tạo đơn/phiếu thu/tồn kho trùng. Đơn đã có GHN không tự khớp theo tiền/thời gian: Manager phải kiểm tra/xử lý COD rồi chọn tay; màn hình hiện mã vận đơn và cảnh báo, không tự sửa hoặc huỷ GHN. Sau khi có bằng chứng SePay, GHN trực tiếp gợi ý COD = 0, chặn thu thêm và chặn sửa hàng/giá đến khi đối chiếu thu/hoàn tiền.
- Chuẩn hoá thời điểm tạo web: `date_created_gmt` là UTC, `date_created` không có múi giờ là giờ Việt Nam. `ordered_at_verified` chỉ bật khi nguồn thực sự gửi ngày tạo. Bản cũ/chỉ có giờ suy đoán không tự khớp theo thời gian; Manager vẫn có thể đối chiếu và chọn tay. Khi webhook bổ sung ngày tạo thật, cờ này được cập nhật; webhook chỉ đổi trạng thái giữ nguyên ngày tạo đã xác minh.
- Lưu cách khớp (`match_method`) và thời điểm tạo đơn tại lúc khớp (`matched_order_at`). Nếu nguồn sửa thời điểm tạo của một liên kết theo thời gian, hoặc sửa số tiền/trạng thái/tài khoản, trang báo cần kiểm tra. Không tự chuyển liên kết hay ghi thêm tiền để sửa.

### Danh sách chọn thủ công

Bấm **Xem / đối soát** mở ngay danh sách **POS / website / đơn CRM / HĐKT**, 20 dòng mỗi trang, có Trước/Sau. Không mặc định giới hạn ngày để tránh ẩn hợp đồng lập trước ngày khách chuyển tiền. Có bộ lọc nguồn, trạng thái, ngày đơn và giá trị; tìm khi ngừng gõ 250 ms, từ khóa có thể để trống. Ngày đơn CRM lấy ngày lập trên chứng từ; POS/web dùng thời điểm nguồn theo ngày Việt Nam. Giá trị lọc là tổng đơn, không suy đoán số còn phải thu. Bản nháp chưa duyệt/ký và đơn hủy hiện lý do không thể chọn; kiểm tra ghi thu vẫn giữ nguyên. Tên công ty/liên hệ/mã khách trong hồ sơ được tìm cùng tên/mã trên đơn, ưu tiên mã khớp chính xác.

Chọn một đơn để xem trước; nhập lý do 10–1.000 ký tự và xác nhận chứng từ. POS phải chọn phiếu có sẵn; web liên kết chứng từ ngân hàng; CRM/HĐKT giữ kiểm tra công nợ và tiền mặt nhân viên đang giữ như trước. Manager có thể giải quyết mã sai trong cùng nguồn, nhưng không chuyển chứng từ đã xác định nguồn POS/web sang luồng khác. Tài khoản chưa duyệt vẫn xem/tìm được; chỉ xác nhận khi đúng tài khoản nhận. Kế toán chỉ xem, không tìm đích hoặc xác nhận qua API quản trị.

### Migration trước merge/deploy

Chạy tay `migrations/postgres/20261109193137_sepay_proximity_indexes.sql` rồi `scripts/sql/assert-sepay-proximity.sql` (kết quả `sepay_proximity_schema_ok`). Thêm 3 trường chứng cứ và 4 index; giữ nguyên số liệu/phiếu thu, không backfill trạng thái tiền hay suy đoán ngày tạo cũ. Unique index chặn hai giao dịch SePay dùng cùng phiếu thu. Nếu dữ liệu cũ vi phạm unique, migration phải dừng để đối chiếu; không tự xoá liên kết. Workflow deploy chỉ kiểm tra schema, không áp dụng migration.

Lịch `sepay-pull-today` hiện có phải hoạt động và có token đọc SePay. Tự đối soát theo thời gian dùng lịch này, không phụ thuộc việc mở trang. Thất bại provider/DB không được coi là đã xử lý thành công. Rollback code giữ nguyên chứng cứ và phiếu thu; không hoàn tiền/xoá dữ liệu để rollback giao diện.

Kiểm tra tập trung: `tests/app/sepay-proximity.test.ts`, `src/modules/sales/domain/sepay-proximity.test.ts`, `tests/db/sepay-proximity-migration.test.ts`. Tranh chấp chạy bằng PostgreSQL cục bộ qua `TEST_PG_URL`; không dùng production. Browser `scripts/testing/sepay-proximity.mjs` dùng module UI và router thật, dữ liệu giả, chặn mọi request ngoài localhost. Fixture PostgreSQL cục bộ với 18.000 đơn web và 6.000 liên kết ngân hàng trải gần ba năm: tìm ứng viên 4,1–15,4 ms; tổng hợp một chỉ số có bằng chứng ngân hàng 197,5–388,7 ms (4 lượt, gồm lượt lạnh). Không phải benchmark toàn trang hay production; raw: `docs/testing/sepay-proximity-performance.json`.

## QR thanh toán web Lock

Nội dung ngân hàng `DH<WooCommerce ID>` (gồm dạng phân cách bằng dấu chấm như `.DH21661.CT...`) tự liên kết với **đơn web Lock gốc** qua `web_order_id`. Không tạo thêm `sales_orders` hoặc `customer_payments`, không sửa tồn kho, doanh thu, tổng đơn hay `date_paid` của WooCommerce. Mã `DH21661` không khớp `DH216610`, tiền tố/hậu tố chữ hoặc mã ghép bằng `/`, `_`, `-`.

Với nhánh đối soát mã QR cũ, đánh dấu khi khớp duy nhất một đơn `source=lock`, đúng tài khoản quầy đã cấu hình/đang hoạt động, đúng toàn bộ tổng tiền VND, phương thức QR, website đã xác nhận `paidAt`, và đơn không huỷ/hoàn, không bị sửa nội dung hoặc xung đột nguồn. Mã đồng thời khớp CRM/POS, nhiều mã, thiếu/thừa tiền hoặc khoản thu thứ hai cho cùng đơn giữ ở trạng thái cần kiểm tra. Tiền có mã QR vào tài khoản quầy Lock nhưng chưa có đơn web phải chờ nguồn web, không tự ghi sang mã CRM trùng.

Webhook SePay, API tải ngày hiện tại và webhook cập nhật đơn web dùng cùng bộ đối soát. Nếu tiền đến trước đơn hoặc trước xác nhận thu tiền từ website, lưu chứng từ chờ; khi webhook Lock đồng bộ đơn/paidAt sẽ thử lại tối đa 100 giao dịch pending có mã tương ứng. Lượt tải API tiếp theo cũng xét lại các dòng chờ đã có, giữ nguyên chứng từ matched/phiếu thu cũ. Không tự sửa dữ liệu giao dịch khi provider ID có nội dung khác.

Ràng buộc DB chỉ cho một đích CRM hoặc web, một provider ID duy nhất và một giao dịch matched trên mỗi đơn web. Khoá provider dùng chung webhook/import; vùng QR nhỏ dùng khoá giao dịch chung trước khoá dòng web để hai batch đảo thứ tự không deadlock. Mọi khớp web được audit bằng ID dòng SePay, hiển thị nhật ký trong chi tiết.

Trang SePay hiển thị **Đã đối soát đơn web**, đúng số đơn gốc và liên kết hồ sơ `#/orders/web:<id>`. Khoản web có biểu mẫu chọn nguồn phù hợp để Manager đối chiếu; API chặn gắn sang đơn CRM. Nếu đơn/paidAt/tài khoản nguồn sau đó bị thay đổi, trang báo cần kiểm tra thay vì coi là một phiếu thu CRM bị thiếu. Các thẻ ghi nhận/đối soát chỉ tổng hợp sổ SePay, không cộng tiền vào sổ kế toán thêm lần nữa.

Trước deploy API, chạy tay `migrations/postgres/20261109123446_sepay_lock_web_match.sql`, rồi `scripts/sql/assert-sepay-web.sql` (phải trả `sepay_web_schema_ok`). Migration chỉ thêm cột/check/index; chạy lại an toàn, giữ RLS, không backfill hoặc sửa dữ liệu cũ. Workflow deploy chỉ assert, không tự chạy migration. Không cần sửa quyền Storage hoặc token/ngân hàng mới.

Ví dụ kiểm tra chỉ đọc trên dữ liệu thật ngày 09/11: `DH21661` khớp đơn `21661`, đúng số tiền/tài khoản quầy và website đã đánh dấu thu tiền; trước triển khai sổ SePay còn review. Đây là chẩn đoán, chưa phải kết quả đối soát đã ghi production.

## Lấy giao dịch hôm nay qua API SePay

- Manager và Kế toán bấm **Lấy giao dịch hôm nay**. Máy chủ tính ngày theo Việt Nam, chỉ GET API SePay bằng token máy chủ; mở trang hoặc làm mới danh sách không gọi SePay. Bộ lọc chuyển sang đúng ngày vừa tải.
- GitHub Actions Secret `SEPAY_API_TOKEN` được workflow deploy API chuyển vào Supabase Edge Secrets bằng file tạm quyền 600 rồi xoá. Không đưa token vào JS, URL, request của nhân viên hoặc log. Token đọc API độc lập với khoá webhook POS; không thay webhook hay danh sách tài khoản tự ghi thu.
- API đối chiếu `count_transactions` với danh sách, kiểm tra toàn bộ giao dịch trước khi ghi. Thiếu dữ liệu, dữ liệu vừa thay đổi, lỗi mạng/quyền hoặc phản hồi sai định dạng đều báo lỗi, không giả thành danh sách rỗng. Mỗi lượt giới hạn dưới 1.000 giao dịch và phản hồi tối đa 3 MB; chạm giới hạn thì từ chối đợt nhập, cần phát triển đồng bộ theo đợt trước khi dùng cho khối lượng lớn.
- Chỉ nhập giao dịch **tiền vào**; hiển thị số dòng không có tiền vào đã bỏ qua. Giao dịch thông thường mới có trạng thái **Cần đối soát**, chưa gắn đơn và chưa tạo phiếu thu. QR web Lock đủ chứng từ website được tự đối soát như trước; quy tắc tiền/thời gian phía trên bổ sung liên kết POS/web khi đủ điều kiện, không tạo phiếu thu CRM mới. Ghi thu vẫn phải qua quy trình đối soát hiện có.
- Khoá theo ID SePay dùng chung với webhook. ID đã có và cùng số tiền/tài khoản/nội dung/thời điểm chỉ tính là trùng; giữ nguyên liên kết/phiếu thu, kể cả phiếu đã huỷ. ID có dữ liệu khác làm toàn bộ đợt nhập rollback. Gửi lại sau khi mất phản hồi không nhập trùng. Webhook được cấu hình tự ghi thu vẫn giữ hành vi hiện có; API tải thủ công không tạo phiếu thu mới; có thể liên kết POS/web theo quy tắc đã nêu.
- Không thêm migration. Khi chưa có token ở Edge, nút bị khoá và trang giải thích thiếu cấu hình.
- Kiểm tra token thực tế: chạy thủ công workflow **Kiểm tra API đọc SePay**. Workflow chỉ GET count/list hôm nay, chỉ in số lượng/tổng tiền, không in tài khoản/nội dung/token và không kết nối CSDL. Không đánh đồng kiểm tra token thành nhập giao dịch vào CRM; sau deploy, nhân viên dùng nút trên trang để nhập.

Hợp đồng provider dùng `GET https://my.sepay.vn/userapi/transactions/count` và `/list`, xác thực Bearer, `transaction_date_min/max` theo giờ Việt Nam, từ `YYYY-MM-DD 00:00:00` đến `YYYY-MM-DD 23:59:59`; adapter kiểm tra số lượng để tránh khẳng định đã tải đủ khi bị giới hạn. Trường REST ánh xạ về payload webhook chuẩn để tái sử dụng đối soát. Đối chiếu tham khảo mã SDK công khai [Transactions PHP](https://github.com/datlechin/sepay-php/blob/main/src/Resources/Transactions.php), [Entity](https://github.com/datlechin/sepay-php/blob/main/src/Entities/Transaction.php), [bộ lọc Python](https://github.com/shinxz12/sepay/blob/main/sepay/transaction.py). Đây là SDK cộng đồng, không phải tài liệu chính thức; docs.sepay.vn trả 403 trong phiên phát triển. Cần workflow kiểm tra chỉ đọc để xác nhận hợp đồng với tài khoản thật trước khi báo kết nối thành công.

Kiểm thử thêm: `tests/app/sepay-read.test.ts`, `scripts/testing/sepay-read-browser.mjs`; Chromium 1440px/390px, API CRM thật trên CSDL cô lập, SePay giả và chặn mạng ngoài. Không dùng token thật trong kiểm thử. Dùng `SEPAY_UI_DIR` và đối số `before` để so với UI gốc, `after` để kiểm tra nút tải, chống bấm lặp, lỗi provider và phục hồi.

Khoản QR POS cần xử lý theo luồng POS để gắn đúng ca. Đơn web chưa chuyển thành đơn CRM chưa thể chọn trên trang này. Không dùng trang để sửa lỗi WooCommerce/GHN hoặc sửa đơn #21618.

## Xem và lọc

- Mặc định từ đầu tháng đến hôm nay theo giờ Việt Nam. Có thể lọc khoảng ngày tối đa 366 ngày, trạng thái, tài khoản nhận, nội dung/mã giao dịch/đơn/khách và khoảng tiền.
- Thẻ tổng hợp tính trên **toàn bộ kết quả theo bộ lọc**, không chỉ trang đang xem. Danh sách phân trang từ máy chủ, mặc định 25 dòng.
- **Đã ghi thu**: đã gắn một phiếu chuyển khoản còn hiệu lực, khớp đơn và số tiền. **Chờ đối soát**: chưa khớp đơn hoặc cần Manager kiểm tra. **Phiếu thu cần kiểm tra**: phiếu đã huỷ, bị thiếu hoặc không còn khớp; trang không tự tạo lại phiếu.
- Bấm một giao dịch để xem số tiền, tài khoản, thời điểm, nội dung gốc, đơn/phiếu đã gắn và lịch sử xử lý. Không được sửa các trường chứng từ ngân hàng trên trang.

## Hiển thị khi bấm Xem / đối soát

Nút đưa focus và cuộn tới khung đối soát ngay khi bắt đầu tải; khi form tải xong chỉ căn lại vị trí nếu người dùng vẫn ở khung đó. Khắc phục trường hợp bố cục một cột đặt chi tiết sau toàn bộ danh sách (đã tái hiện trên mobile 390px: tiêu đề nằm ngoài viewport ở tọa độ y=2173px).

Nút **Về giao dịch** cuộn/focus về đúng dòng đã chọn, giữ nguyên dữ liệu và nội dung đang nhập, không gọi API ghi. Nếu dòng không còn trong bộ lọc, quay về danh sách. Focus có hiển thị cho bàn phím, khung có nhãn accessible và khoảng cách tránh header cố định.

Thay đổi này không sửa quyền hoặc điều kiện ghi thu. Kế toán chỉ xem/đối chiếu; Manager chỉ xác nhận CRM/HĐKT khi tài khoản nhận đã có trong `SEPAY_RECEIPT_ACCOUNTS`; POS/web phải khớp tài khoản quầy đang hoạt động. Nếu khung hiện cảnh báo tài khoản chưa được duyệt, cần cấu hình đúng tài khoản đã được công ty xác nhận theo `docs/SEPAY-RECEIPTS.md`; không bỏ kiểm tra này chỉ để hiện nút xác nhận.

Kiểm tra browser fixture cô lập: danh sách dài ở 390/1440px, focus và vị trí dưới header, quay lại đúng dòng, tạo/gắn phiếu thu, chống bấm trùng, mất phản hồi sau ghi, lỗi tải danh sách, quyền Kế toán/Sale và nội dung không tin cậy. Không gọi production trong kiểm thử.

## Chọn đơn/HĐKT khi tài khoản nhận chưa được duyệt

Manager vẫn được tìm/chọn đơn hoặc HĐKT và xem công nợ dù tài khoản chưa có trong `SEPAY_RECEIPT_ACCOUNTS`. Đây là bước đọc/đối chiếu, không ghi nhận thanh toán hoặc lưu liên kết tạm vào DB. Giao diện chỉ ẩn phần xác nhận ghi thu, nêu rõ nguyên nhân và có nút kiểm tra lại tài khoản.

Sau khi tài khoản công ty được xác nhận và cấu hình trên máy chủ, bấm **Kiểm tra lại tài khoản**, chọn lại chứng từ để lấy công nợ mới nhất, rồi theo luồng xác nhận. Kế toán vẫn chỉ đọc; khoản POS/web giữ luồng riêng. Không bỏ hoặc nới kiểm tra tài khoản ở API. Không cần migration cho thay đổi giao diện này.

## Manager xử lý giao dịch thiếu hoặc sai mã

1. Mở giao dịch chờ đối soát; kiểm tra chứng từ ngân hàng thật.
2. Tìm bằng số đơn/HĐKT hoặc tên khách; chọn đúng đơn CRM/HĐKT còn hiệu lực công nợ. Trang hiển thị số còn phải thu, tiền mặt nhân viên đang giữ và số còn có thể thu.
3. Chọn **Tạo phiếu thu mới** hoặc **Gắn phiếu thu hiện có**. Chỉ phiếu chuyển khoản còn hiệu lực, cùng đơn, cùng số tiền và ngày thu Việt Nam, chưa gắn giao dịch SePay khác mới được đề xuất. Gắn phiếu có sẵn không cộng thêm tiền.
4. Ghi lý do 10–1.000 ký tự, tích đã đối chiếu; bấm **Xem trước khi xác nhận** và kiểm tra lại số tiền, tài khoản, chứng từ, đơn/khách và cách ghi nhận.
5. Bấm **Xác nhận ghi thu**. Máy chủ kiểm tra lại công nợ và chứng từ dưới khoá giao dịch, ghi phiếu thu/liên kết và nhật ký cùng một transaction.

Không thể ép ghi thu vào đơn huỷ, nháp chưa có công nợ, tạo mới phiếu POS ngoài luồng quầy, tài khoản chưa được duyệt, hoặc tạo phiếu thu vượt công nợ sau khi trừ tiền nhân viên đang giữ. Nếu có phiếu nhập trước trùng số tiền/ngày hay mã giao dịch, phải đối chiếu và chọn phiếu phù hợp; không tạo thêm để bỏ qua cảnh báo. Trang không đổi đơn đã ghi nhận sang đơn khác.

Nếu phản hồi mạng bị mất, trạng thái có thể đã ghi thành công: bấm tải lại để kiểm tra. Không tự retry ghi tiền. Bấm lặp hoặc hai Manager xác nhận cùng lúc không tạo thêm phiếu cho cùng giao dịch; hai khoản cùng thu một đơn cũng kiểm tra lại giới hạn công nợ.

## Hiệu năng và kiểm thử

Mã và CSS của trang chỉ tải khi mở SePay; không thêm timer riêng, làm mới theo pulse khi đang hoạt động. Danh sách dùng hai truy vấn dữ liệu ngân hàng (tổng hợp và trang dòng) trong snapshot chỉ đọc nhất quán. Không gọi công nợ từng dòng. Công nợ chi tiết chỉ tính khi Manager chọn một đơn. Kết quả đến muộn sau khi rời trang/đổi giao dịch/đăng xuất bị bỏ qua.

- API: `node --import tsx --test tests/app/sepay-page.test.ts tests/app/sepay-payment.test.ts`
- Đồng thời trên PostgreSQL kiểm thử: đặt `TEST_PG_URL` tới CSDL giả cục bộ rồi chạy `tests/app/sepay-page.test.ts`; không dùng URL production.
- Giao diện/kiến trúc: `node --import tsx --test tests/app/sepay-ui.test.ts tests/app/mobile-nav-order.test.ts tests/architecture.test.ts`
- Trình duyệt với dữ liệu giả và router thật: `PLAYWRIGHT_MODULE=<đường dẫn module Playwright> node --import tsx scripts/testing/sepay-page.mjs`. Toàn bộ request ra ngoài máy cục bộ bị chặn.

## Triển khai và rollback

Chỉ triển khai sau khi PR và CI được duyệt, migration có sẵn của PR #581 đã chạy và cổng kiểm tra schema chỉ đọc thành công. Không chạy migration production từ bộ kiểm thử.

Nếu cần rollback riêng trang, hoàn nguyên commit trang/API này, giữ nguyên inbox và phiếu thu đã ghi đúng. Không xoá dữ liệu hay huỷ phiếu thu để rollback giao diện. Webhook gốc và hai API quản trị cũ vẫn có trong bản nền PR #581.

Đo trước/sau (3 lượt lạnh mỗi viewport, cùng hàng dữ liệu thử): PC ready median 3091 → 3050 ms; mobile 3038 → 3032 ms. Không tăng số request lúc mở trang; JS trang tăng 1.880 byte. CLS khởi động ứng dụng đã cao ở bản nền (PC 0,476; mobile 0,232), sau thay đổi lần lượt 0,476/0,234; đây chưa phải bản sửa CLS toàn app. Điều kiện và số liệu đầy đủ trong `docs/testing/sepay-read-performance.json`, không dùng các số này làm độ trễ production.

### Sửa phạm vi ngày API đọc (09/11/2026)

Kiểm tra chỉ đọc bằng cùng API token: khoảng ngày thuần `2026-11-09` → `2026-11-09` trả 0; khoảng giờ đầy đủ `00:00:00` → `23:59:59` trả 6 giao dịch. SePay coi cận trên thiếu giờ là đầu ngày. Cả `/count` và `/list` nay dùng khoảng giờ đầy đủ; test bao gồm đầu ngày, cuối ngày và loại hai ngày liền kề. Workflow chỉ in số liệu tổng hợp, không nhập giao dịch, không tạo phiếu thu.

## Đồng bộ tự động

- Webhook `/integrations/sepay/payment` vẫn là luồng nhận ngay khi SePay đẩy giao dịch. Cần cấu hình đúng URL và Apikey trong SePay. Log ngày 09/11/2026 có lượt HTTP 401; không thể coi webhook đã hoạt động chỉ vì API đọc thành công. Không thay hoặc xoá webhook POS đang dùng.
- Lịch Supabase `sepay-pull-today` (`supabase/sepay-pull-cron.sql`) là dự phòng mỗi 5 phút, kể cả khi không ai mở CRM. Workflow deploy cài lịch theo tên sau khi triển khai API, kiểm tra cấu hình rồi đồng bộ lần đầu; sử dụng pg_cron/pg_net và token máy chủ `sapo_sync_token` trong Vault đã có. Không tạo schema hoặc đọc token ra log. Cài lại cùng tên không tạo lịch trùng. Không dùng token đọc SePay để xác thực endpoint nội bộ.
- POST `/integrations/sepay/pull` chỉ nhận `{}`, xác thực máy chủ `sapo-sync`; cookie nhân viên không đủ quyền. Tái sử dụng cùng importer với nút tải tay, khóa ID, không ghi đè giao dịch cũ và không tạo phiếu thu. Giao dịch thông thường vào trạng thái Cần đối soát; QR web Lock đủ điều kiện được tự liên kết với khoản thu website. Mỗi lần chỉ lấy ngày hiện tại Việt Nam; webhook xử lý sự kiện ngoài ngày và không tự nhập toàn bộ lịch sử.
- Trang SePay mở/đang hoạt động làm mới danh sách theo nhịp `/pulse` sẵn có (30 giây), không thêm timer, không gọi SePay từ trình duyệt. Dừng khi ẩn tab, đăng xuất/rời trang, đang ghi hoặc mở chi tiết đối soát; giữ nguyên bộ lọc và biểu mẫu. Khi đóng chi tiết/rời rồi quay lại trang, dữ liệu sẽ cập nhật.
- Lỗi provider/xác thực ở lượt đầu làm workflow deploy đỏ với mã HTTP, không giả báo đồng bộ thành công. Log chỉ in tổng hợp; không in token, tài khoản hay nội dung giao dịch.

Theo dõi định kỳ: `cron.job_run_details` xác nhận gọi pg_net, còn HTTP 200 của API trong log Edge mới xác nhận nhập thành công; tác vụ cron enqueue thành công không có nghĩa provider/HTTP đã thành công.

Kiểm tra tự đồng bộ: 15 test đạt, 1 test tranh chấp PostgreSQL bỏ qua trong PGlite; browser 1440/390 kiểm tra tự cập nhật, bộ lọc và bảo toàn đối soát. Đo 3 lượt cold/viewport trong fixture cô lập, latency 40 ms: median sẵn sàng PC 3.118 s, mobile 3.075 s; 15 API và 163 JS lúc mở trang như benchmark trước, không phải tốc độ production. Raw: `docs/testing/sepay-auto-performance.json`.

Kiểm thử QR web: 54/54 test liên quan đạt (tranh chấp trên PostgreSQL 17), thêm 20/20 test tập trung sau khi chặn form CRM cho QR đang chờ nguồn. Browser PC/mobile mở đúng đơn web và không sinh phiếu thu CRM. Đo 3 lượt cold/viewport, mạng giả lập 40ms: ready PC 3076→3080ms, mobile 3049→3093ms, vẫn 15 API/163 JS khi mở trang. Raw `docs/testing/sepay-web-performance.json`; không phải phép đo production.

## Danh sách chọn đơn/HĐKT trong đối soát

Khi Manager mở giao dịch cần đối soát, tải sẵn tối đa 20 đơn POS/web/CRM/HĐKT mỗi trang; không tải toàn bộ đơn hoặc tính công nợ từng dòng. Tìm khi ngừng gõ 250 ms, hỗ trợ tên công ty trong hồ sơ khách, tên trên đơn, liên hệ, điện thoại, mã khách, mã báo giá/đơn/HĐKT; bỏ dấu/hoa thường, nhiều từ khác thứ tự, mã khác dấu phân cách. Mã khớp chính xác được ưu tiên trước ngày lập mới nhất.

Bộ lọc: nguồn chứng từ (POS/web/CRM/HĐKT/tất cả), tình trạng (chưa hủy/có thể chọn/bản nháp/đã hủy/tất cả), khoảng ngày lập. Có phân trang và nút bỏ bộ lọc. Mặc định chưa hủy, gồm bản nháp; bản nháp chưa duyệt/ký hiển thị lý do chưa thể chọn, thay vì mất hẳn khỏi kết quả. Đơn đã hủy chỉ hiện khi lọc tương ứng, không thể chọn. Điều kiện công nợ vẫn dùng quy tắc hiện hành: đơn draft có HĐKT signed/completed được chọn; draft chưa ký không được ghi thu.

Thay từ khóa/bộ lọc bỏ lựa chọn và bản xác nhận trước đó; phản hồi cũ bị bỏ qua khi tìm tiếp, chọn đơn khác, đổi giao dịch hoặc rời trang. Hủy timer tìm khi rời trang; không thêm polling. Giữ quyền Manager, không gán nhầm giữa các nguồn POS/web/CRM, kiểm tra lại công nợ và tài khoản nhận ở lúc ghi thu. Không tự duyệt ngân hàng hoặc chứng từ; không cần migration cho thay đổi tìm kiếm này. Triển khai cả API và UI cùng phiên bản.

Kiểm thử riêng phần tìm kiếm của PR #600: 20 test đạt, 3 test tranh chấp PostgreSQL được bỏ qua theo điều kiện PGlite; typecheck và UI build đạt. Browser dùng router thật với dữ liệu kiểm thử cô lập: 9 nhóm kiểm tra PC/mobile đạt, gồm danh sách sẵn, tìm khi gõ, lọc, phân trang, bản nháp, quyền và ghi thu một lần. Không sửa dữ liệu production để kiểm thử. Số đo và điều kiện trong `docs/testing/sepay-search-performance.json`.

Đo riêng PR #600 khi mở trang SePay (3 lượt lạnh/viewport, latency 40 ms, 1,6 MB/s): 1440px ready 3156→3108 ms; 390px ready 3125→3053 ms. Vẫn 15 API/163 JS khi mở trang; chỉ thêm một lượt đọc danh sách khi mở chi tiết cần đối soát. Median danh sách sẵn sau mở chi tiết: PC 94 ms/mobile 96 ms; tìm khi gõ gồm debounce: PC 303 ms/mobile 307 ms (không giả lập mạng cho các số picker). Đây là số cục bộ, không khẳng định độ trễ production hoặc đã sửa CLS toàn app.

Sau gộp main vào PR #601: hồi quy 54 đạt, 5 test cần PostgreSQL riêng bỏ qua theo cấu hình; typecheck/UI build đạt. Hai bộ browser PC/mobile đạt: tìm kiếm/bản nháp/quyền/ghi thu và chọn POS/web/CRM, không thu trùng, không sửa snapshot web. Danh sách giữ phân trang Trước/Sau 20 dòng và tìm khi gõ của #600, thêm nguồn/số tiền của #601; không tự giới hạn ngày tìm thủ công. Đo 3 lượt lạnh mỗi viewport, baseline #601 `2b05622a`: 1440px ready 3149→3113 ms; 390px ready 3065→3040 ms. Số API/JS lúc mở trang giữ nguyên; đây là phép đo cục bộ, không phải production. Raw `docs/testing/sepay-601-merge-performance.json`.

### Thao tác gán khoản thu

Mỗi kết quả có nút **Chọn đơn này để gán khoản thu**. Bấm nút chỉ mở bước xem trước, chưa ghi dữ liệu. Màn hình đưa focus tới công nợ/đơn đã chọn, đánh dấu thẻ tương ứng và hiển thị số tiền sẽ gán. Nhập lý do, xác nhận đã đối chiếu, bấm **Xem lại để gán khoản thu**, rồi **Xác nhận gán khoản thu**; bước kiểm tra cuối cũng tự hiện trong vùng nhìn thấy trên điện thoại.

Bản nháp chưa duyệt/ký và đơn hủy ghi rõ lý do không thể chọn. Nếu tài khoản nhận chưa được duyệt, phần xem trước hiện nút gán bị khóa kèm lý do và nút kiểm tra lại tài khoản; không tự bật quyền ghi thu. Không thay đổi API, chứng từ, số dư hoặc cấu hình ngân hàng trong thay đổi giao diện này.

Kiểm thử: 13 test liên quan đạt, 1 test tranh chấp PostgreSQL bỏ qua theo cấu hình. Hai bộ browser PC/mobile đạt: kiểm tra chọn từ 20 kết quả và tự hiện bước gán, số tiền/đơn đích, nút bị khóa cho tài khoản chưa duyệt, xác nhận cuối được nhìn thấy, phân quyền, ghi thu/gắn phiếu một lần và chọn POS/web/CRM. Typecheck và UI build đạt. Số đo mở trang 3 lượt mỗi viewport trước/sau được lưu trong `docs/testing/sepay-assignment-performance.json`; không dùng làm tốc độ production.
