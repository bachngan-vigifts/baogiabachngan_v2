# Trang ghi nhận thanh toán SePay

## Quyền và phạm vi

Mở **Tiền & công nợ → Thanh toán SePay** (`#/sepay`); điện thoại vào nhóm **Tiền** ở menu chân trang. Manager và Kế toán được xem danh sách, chứng từ gốc và lịch sử xử lý. Chỉ Manager được tìm đơn/HĐKT, xem trước cách ghi nhận và xác nhận. API kiểm tra quyền độc lập với giao diện.

Trang hiển thị giao dịch tiền vào đã được webhook CRM hoặc thao tác tải API lưu trong `sepay_transactions`. Trang không tải sao kê lịch sử trực tiếp từ ngân hàng. Dùng migration và cấu hình tài khoản đã có trong [luồng nhận webhook](SEPAY-RECEIPTS.md); phần trang không thêm migration hay tự cấu hình webhook.

## QR thanh toán web Lock

Nội dung ngân hàng `DH<WooCommerce ID>` (gồm dạng phân cách bằng dấu chấm như `.DH21661.CT...`) tự liên kết với **đơn web Lock gốc** qua `web_order_id`. Không tạo thêm `sales_orders` hoặc `customer_payments`, không sửa tồn kho, doanh thu, tổng đơn hay `date_paid` của WooCommerce. Mã `DH21661` không khớp `DH216610`, tiền tố/hậu tố chữ hoặc mã ghép bằng `/`, `_`, `-`.

Chỉ đánh dấu đã đối soát khi khớp duy nhất một đơn `source=lock`, đúng tài khoản quầy đã cấu hình/đang hoạt động, đúng toàn bộ tổng tiền VND, phương thức QR, website đã xác nhận `paidAt`, và đơn không huỷ/hoàn, không bị sửa nội dung hoặc xung đột nguồn. Mã đồng thời khớp CRM/POS, nhiều mã, thiếu/thừa tiền hoặc khoản thu thứ hai cho cùng đơn giữ ở trạng thái cần kiểm tra. Tiền có mã QR vào tài khoản quầy Lock nhưng chưa có đơn web phải chờ nguồn web, không tự ghi sang mã CRM trùng.

Webhook SePay, API tải ngày hiện tại và webhook cập nhật đơn web dùng cùng bộ đối soát. Nếu tiền đến trước đơn hoặc trước xác nhận thu tiền từ website, lưu chứng từ chờ; khi webhook Lock đồng bộ đơn/paidAt sẽ thử lại tối đa 100 giao dịch pending có mã tương ứng. Lượt tải API tiếp theo cũng xét lại các dòng chờ đã có, giữ nguyên chứng từ matched/phiếu thu cũ. Không tự sửa dữ liệu giao dịch khi provider ID có nội dung khác.

Ràng buộc DB chỉ cho một đích CRM hoặc web, một provider ID duy nhất và một giao dịch matched trên mỗi đơn web. Khoá provider dùng chung webhook/import; vùng QR nhỏ dùng khoá giao dịch chung trước khoá dòng web để hai batch đảo thứ tự không deadlock. Mọi khớp web được audit bằng ID dòng SePay, hiển thị nhật ký trong chi tiết.

Trang SePay hiển thị **Đã đối soát đơn web**, đúng số đơn gốc và liên kết hồ sơ `#/orders/web:<id>`. Khoản web không có biểu mẫu gắn sang đơn CRM. Nếu đơn/paidAt/tài khoản nguồn sau đó bị thay đổi, trang báo cần kiểm tra thay vì coi là một phiếu thu CRM bị thiếu. Các thẻ ghi nhận/đối soát chỉ tổng hợp sổ SePay, không cộng tiền vào sổ kế toán thêm lần nữa.

Trước deploy API, chạy tay `migrations/postgres/20261109123446_sepay_lock_web_match.sql`, rồi `scripts/sql/assert-sepay-web.sql` (phải trả `sepay_web_schema_ok`). Migration chỉ thêm cột/check/index; chạy lại an toàn, giữ RLS, không backfill hoặc sửa dữ liệu cũ. Workflow deploy chỉ assert, không tự chạy migration. Không cần sửa quyền Storage hoặc token/ngân hàng mới.

Ví dụ kiểm tra chỉ đọc trên dữ liệu thật ngày 09/11: `DH21661` khớp đơn `21661`, đúng số tiền/tài khoản quầy và website đã đánh dấu thu tiền; trước triển khai sổ SePay còn review. Đây là chẩn đoán, chưa phải kết quả đối soát đã ghi production.

## Lấy giao dịch hôm nay qua API SePay

- Manager và Kế toán bấm **Lấy giao dịch hôm nay**. Máy chủ tính ngày theo Việt Nam, chỉ GET API SePay bằng token máy chủ; mở trang hoặc làm mới danh sách không gọi SePay. Bộ lọc chuyển sang đúng ngày vừa tải.
- GitHub Actions Secret `SEPAY_API_TOKEN` được workflow deploy API chuyển vào Supabase Edge Secrets bằng file tạm quyền 600 rồi xoá. Không đưa token vào JS, URL, request của nhân viên hoặc log. Token đọc API độc lập với khoá webhook POS; không thay webhook hay danh sách tài khoản tự ghi thu.
- API đối chiếu `count_transactions` với danh sách, kiểm tra toàn bộ giao dịch trước khi ghi. Thiếu dữ liệu, dữ liệu vừa thay đổi, lỗi mạng/quyền hoặc phản hồi sai định dạng đều báo lỗi, không giả thành danh sách rỗng. Mỗi lượt giới hạn dưới 1.000 giao dịch và phản hồi tối đa 3 MB; chạm giới hạn thì từ chối đợt nhập, cần phát triển đồng bộ theo đợt trước khi dùng cho khối lượng lớn.
- Chỉ nhập giao dịch **tiền vào**; hiển thị số dòng không có tiền vào đã bỏ qua. Giao dịch mới có trạng thái **Cần đối soát**, chưa gắn đơn và chưa tạo phiếu thu. Ghi thu vẫn phải qua quy trình đối soát hiện có.
- Khoá theo ID SePay dùng chung với webhook. ID đã có và cùng số tiền/tài khoản/nội dung/thời điểm chỉ tính là trùng; giữ nguyên liên kết/phiếu thu, kể cả phiếu đã huỷ. ID có dữ liệu khác làm toàn bộ đợt nhập rollback. Gửi lại sau khi mất phản hồi không nhập trùng. Webhook được cấu hình tự ghi thu vẫn giữ hành vi hiện có; API tải thủ công không tự ghi thu.
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

## Manager xử lý giao dịch thiếu hoặc sai mã

1. Mở giao dịch chờ đối soát; kiểm tra chứng từ ngân hàng thật.
2. Tìm bằng số đơn/HĐKT hoặc tên khách; chọn đúng đơn CRM/HĐKT còn hiệu lực công nợ. Trang hiển thị số còn phải thu, tiền mặt nhân viên đang giữ và số còn có thể thu.
3. Chọn **Tạo phiếu thu mới** hoặc **Gắn phiếu thu hiện có**. Chỉ phiếu chuyển khoản còn hiệu lực, cùng đơn, cùng số tiền và ngày thu Việt Nam, chưa gắn giao dịch SePay khác mới được đề xuất. Gắn phiếu có sẵn không cộng thêm tiền.
4. Ghi lý do 10–1.000 ký tự, tích đã đối chiếu; bấm **Xem trước khi xác nhận** và kiểm tra lại số tiền, tài khoản, chứng từ, đơn/khách và cách ghi nhận.
5. Bấm **Xác nhận ghi thu**. Máy chủ kiểm tra lại công nợ và chứng từ dưới khoá giao dịch, ghi phiếu thu/liên kết và nhật ký cùng một transaction.

Không thể ép ghi thu vào đơn huỷ, nháp chưa có công nợ, đơn POS, tài khoản chưa được duyệt, hoặc tạo phiếu thu vượt công nợ sau khi trừ tiền nhân viên đang giữ. Nếu có phiếu nhập trước trùng số tiền/ngày hay mã giao dịch, phải đối chiếu và chọn phiếu phù hợp; không tạo thêm để bỏ qua cảnh báo. Trang không đổi đơn đã ghi nhận sang đơn khác.

Nếu phản hồi mạng bị mất, trạng thái có thể đã ghi thành công: bấm tải lại để kiểm tra. Không tự retry ghi tiền. Bấm lặp hoặc hai Manager xác nhận cùng lúc không tạo thêm phiếu cho cùng giao dịch; hai khoản cùng thu một đơn cũng kiểm tra lại giới hạn công nợ.

## Hiệu năng và kiểm thử

Mã và CSS của trang chỉ tải khi mở SePay; không polling. Danh sách dùng hai truy vấn dữ liệu ngân hàng (tổng hợp và trang dòng) trong snapshot chỉ đọc nhất quán. Không gọi công nợ từng dòng. Công nợ chi tiết chỉ tính khi Manager chọn một đơn. Kết quả đến muộn sau khi rời trang/đổi giao dịch/đăng xuất bị bỏ qua.

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
- POST `/integrations/sepay/pull` chỉ nhận `{}`, xác thực máy chủ `sapo-sync`; cookie nhân viên không đủ quyền. Tái sử dụng cùng importer với nút tải tay, khóa ID, không ghi đè giao dịch cũ và không tạo phiếu thu. Tất cả giao dịch mới vào trạng thái Cần đối soát. Mỗi lần chỉ lấy ngày hiện tại Việt Nam; webhook xử lý sự kiện ngoài ngày và không tự nhập toàn bộ lịch sử.
- Trang SePay mở/đang hoạt động làm mới danh sách theo nhịp `/pulse` sẵn có (30 giây), không thêm timer, không gọi SePay từ trình duyệt. Dừng khi ẩn tab, đăng xuất/rời trang, đang ghi hoặc mở chi tiết đối soát; giữ nguyên bộ lọc và biểu mẫu. Khi đóng chi tiết/rời rồi quay lại trang, dữ liệu sẽ cập nhật.
- Lỗi provider/xác thực ở lượt đầu làm workflow deploy đỏ với mã HTTP, không giả báo đồng bộ thành công. Log chỉ in tổng hợp; không in token, tài khoản hay nội dung giao dịch.

Theo dõi định kỳ: `cron.job_run_details` xác nhận gọi pg_net, còn HTTP 200 của API trong log Edge mới xác nhận nhập thành công; tác vụ cron enqueue thành công không có nghĩa provider/HTTP đã thành công.

Kiểm tra tự đồng bộ: 15 test đạt, 1 test tranh chấp PostgreSQL bỏ qua trong PGlite; browser 1440/390 kiểm tra tự cập nhật, bộ lọc và bảo toàn đối soát. Đo 3 lượt cold/viewport trong fixture cô lập, latency 40 ms: median sẵn sàng PC 3.118 s, mobile 3.075 s; 15 API và 163 JS lúc mở trang như benchmark trước, không phải tốc độ production. Raw: `docs/testing/sepay-auto-performance.json`.
