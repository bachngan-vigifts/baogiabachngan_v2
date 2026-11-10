# Nhận thanh toán SePay cho đơn CRM

API `POST /api/staff/integrations/sepay/payment` nhận webhook bằng `Authorization: Apikey …`, dùng hash `SEPAY_POS_API_KEY_HASH` hiện có. Không dùng cookie nhân viên và không nhận mã bí mật trong URL.

## Trước khi triển khai

1. Chạy tay migration có sẵn của PR #581: `migrations/postgres/20261109050000_sepay_transactions.sql`. Bản sửa không thay migration này và không sửa dữ liệu production. `scripts/sql/assert-sepay-transactions.sql` kiểm tra chỉ đọc bảng/cột, chỉ mục chống trùng và RLS; workflow deploy dừng trước khi triển khai nếu chưa đủ.
2. Cấu hình secret Edge Function `SEPAY_RECEIPT_ACCOUNTS` gồm các tài khoản **công ty đã xác nhận nhận tiền cho đơn CRM**, cách nhau bằng dấu phẩy; giữ số 0 ở đầu. Không lấy tài khoản từ nội dung chuyển khoản. Thiếu cấu hình hoặc tài khoản chưa được duyệt: lưu giao dịch ở trạng thái `review`, chưa tạo phiếu thu.
3. Giữ nguyên webhook `/integrations/sepay/pos-payment` đang dùng cho QR tại quầy. Không thay URL đó bằng endpoint CRM này. Endpoint CRM không tự ghi thu vào ca POS: tiền POS cần đi qua luồng POS để có đúng ca, yêu cầu QR và chứng từ.
4. Kiểm thử trên dữ liệu giả và xem CI xanh trước khi merge. Tài liệu này không cho phép tự chạy migration, đổi webhook hay deploy production.

## Quy tắc ghi thu

- Chỉ nhận giao dịch tiền vào, số tiền nguyên VNĐ lớn hơn 0 và tối đa 1.000 tỷ; phải có ID, tài khoản, nội dung và thời điểm giao dịch hợp lệ. Không có thời điểm thì từ chối, không tự gán hôm nay.
- Ngày/giờ thiếu múi giờ được hiểu theo Việt Nam (+07:00). Inbox giữ timestamp UTC; phiếu thu lưu ngày Việt Nam `YYYY-MM-DD` để thống nhất với sổ quỹ/báo cáo.
- Khớp **toàn bộ mã** đơn, báo giá, mã Sapo hoặc HĐKT. Bỏ dấu tiếng Việt và các dấu phân cách trong mã, nhưng không khớp `DH10` vào `DH1`. Các phần nối bằng gạch ngang, gạch dưới, dấu chấm hoặc dấu `/` (kể cả khoảng trắng quanh dấu nối) được giữ trong cùng một mã; không lấy tiền tố/hậu tố của mã dài làm mã độc lập. Một nội dung khớp nhiều đơn: `review`. Nội dung quá phức tạp: không tự ghi thu.
- Khi phát hiện mã mơ hồ, tính cả chứng từ huỷ/nháp: không loại mã dài rồi tự chuyển sang mã ngắn còn hiệu lực. Một mã đầy đủ chỉ trỏ tới chứng từ huỷ/nháp chưa ký vẫn không ghi thu.
- Chỉ tính đơn còn hiệu lực công nợ; HĐKT nháp đã ký/hoàn tất vẫn có công nợ theo quy tắc chung. Đơn huỷ và nháp chưa ký không được ghi thu tự động.
- Số còn nợ lấy từ cùng hàm đang xử lý hàng trả, hoàn tiền, đổi hàng và phiếu thu bị huỷ. Khoản vượt số còn nợ: `review`; không âm thầm cắt số tiền.
- Ghi thu trong transaction, cùng khóa tiền với POS/thu thủ công/COD/hàng trả và khóa dòng đơn. Kiểm tra lại trạng thái và công nợ dưới khóa. Ghi inbox và phiếu thu cùng thành công hoặc cùng rollback.
- Cùng ID SePay và cùng dữ liệu: không tạo thêm phiếu thu. Cùng ID nhưng khác số tiền, tài khoản, nội dung hoặc thời điểm: HTTP 409. Gửi lại giao dịch đã tạo phiếu thu rồi bị huỷ cũng không làm sống lại phiếu.
- Nếu có phiếu chuyển khoản nhập trước trùng mã SePay hoặc cùng số tiền/ngày thu, giữ giao dịch ở `review` để tránh thu hai lần. Hai khoản thật sự khác nhau nhưng trùng số tiền/ngày cần Manager đối chiếu chứng từ; không tự coi là cùng một khoản hay cộng thêm. Phiếu đã huỷ và tín dụng đổi hàng không được dùng làm bằng chứng trùng.
- Giao dịch `unmatched`/`review` có thể được đánh giá lại khi webhook gửi lại sau khi đơn/cấu hình đã sẵn sàng. Chỉ tự ghi thu nếu vẫn qua đủ các kiểm tra trên.

## Đối soát dành cho Manager

- `GET /api/staff/admin/sepay-transactions?status=review&limit=50&offset=0`: danh sách phân trang; trạng thái hợp lệ `review`, `unmatched`, `matched`. Không trả raw payload. Chỉ Manager được xem.
- `POST /api/staff/admin/sepay-transactions/<id>/reconcile`, JSON `{}`: đọc lại payload đã lưu và kiểm tra lại tài khoản, mã đơn, trạng thái và công nợ; không cho người gọi sửa số tiền hoặc ép khớp một đơn khác. Có nhật ký Manager đối soát. Gọi lại sau khi khớp không tạo thêm phiếu thu.
- Trang **Tiền & công nợ → Thanh toán SePay** (`#/sepay`) cho Manager và Kế toán xem; chỉ Manager được chọn đơn/HĐKT, ghi lý do và xác nhận. Xem [hướng dẫn trang SePay](SEPAY-PAGE.md). Hai API quản trị cũ vẫn chỉ dành cho Manager và giữ nguyên hành vi.
- Trường hợp chuyển dư hoặc chuyển gộp cần xác minh theo quy trình nghiệp vụ; trang không chia nhỏ giao dịch hay cắt số tiền. Không tự tạo webhook mới để lách chống trùng.

## Giới hạn và rollback

Luồng này không đổi trạng thái WooCommerce, không chốt/huỷ/tạo lại GHN, không sửa các đơn web cũ và không phải bản sửa lỗi WooCommerce tự đặt `date_paid` khi chuyển `processing`. Bản sửa nguồn GHN–Woo phải được kiểm tra riêng; không dùng PR này để tự sửa đơn #21618.

Để tạm dừng tự ghi thu CRM, bỏ cấu hình `SEPAY_RECEIPT_ACCOUNTS`; webhook tiếp tục lưu để đối soát. Không xoá inbox hay phiếu thu đã ghi đúng. Nếu rollback code về main trước PR #581, giữ bảng mới; không cần drop bảng và không sửa migration cũ.

## Kiểm thử

- `node --import tsx --test tests/app/sepay-payment.test.ts src/modules/integrations/domain/sepay-payment.test.ts tests/architecture.test.ts`
- `TEST_PG_URL=<CSDL kiểm thử cục bộ> node --import tsx --test tests/app/sepay-payment.test.ts` chạy cả ca đồng thời. Helper tạo database tạm riêng rồi xoá; tuyệt đối không trỏ biến này vào production.
- `npm test`/CI chạy bộ hồi quy đầy đủ, gồm POS, QR, COD, tài chính và WordPress GHN.

## Hồi quy ranh giới mã PR #581

Đã tái hiện trước sửa: nội dung `DH_20261109_001-ABC` có thể tạo phiếu thu vào `DH_20261109_001` và giảm nhầm công nợ, khi mã dài chưa có hoặc thuộc đơn huỷ/nháp. Hai test hồi quy (domain và API) thất bại trên bản cũ trước khi sửa.

Sau sửa, các ca tiền tố/hậu tố qua dấu nối, dấu nối lặp và khoảng trắng quanh dấu nối không tạo phiếu thu; tiền vẫn nằm trong inbox để đối soát. Mã dài bị huỷ/nháp không dẫn tiền sang đơn ngắn khi chuẩn hoá khoảng trắng. Chạy lại webhook và Manager đối soát đều giữ nguyên công nợ đơn ngắn. Mã dài đầy đủ của đơn hợp lệ vẫn được thu đúng và replay không tạo phiếu thứ hai.

Kiểm tra cục bộ: PGlite đạt 26/27 (ca đồng thời chỉ chạy trên PostgreSQL); PostgreSQL 17.11 cô lập đạt 27/27, không bỏ qua ca nào, gồm gửi trùng ID, hai ID cùng đơn, đồng thời với thu thủ công và huỷ đơn. Giữ kiểm tra kiến trúc, không sửa migration hay cấu hình production. CI cần kiểm tra lại đúng commit sửa mới trước khi merge.

## Gán thủ công bởi Manager

Điều kiện tài khoản cho webhook tự động ở trên giữ nguyên. Khi Manager chọn chứng từ và xác nhận trên trang SePay, tài khoản nhận có thể đến từ danh sách CRM hoặc tài khoản ngân hàng đã cấu hình ở quầy đang hoạt động. API chi tiết, xem trước và ghi thu dùng chung phép kiểm tra; ghi thu kiểm tra lại cấu hình hiện tại. Không tự thêm tài khoản vào secret, không bật tự ghi thu cho CRM vì một tài khoản quầy tồn tại. Tài khoản ngoài cấu hình hoặc quầy ngừng hoạt động vẫn bị chặn; POS/web vẫn xác minh đúng nguồn riêng. Xem `docs/SEPAY-PAGE.md`.
