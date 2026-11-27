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

HĐKT VG có mã `/HĐKT/VG-…` có mặc định riêng cho gán thủ công: tài khoản 159063909. Dùng mã HĐKT lưu trong CRM để xác định; không ghi đè tài khoản ngân hàng thực nhận và không tự bật webhook/import. Xem `src/modules/sales/domain/sepay-crm-account.ts` và hướng dẫn tại `docs/SEPAY-PAGE.md`.

### Đối soát chi tiết khi dư / thiếu tiền

Trong **Thanh toán SePay → mở giao dịch → Đối soát chi tiết · nhiều đơn**, chọn chứng từ, nhập số thực nhận hoặc chọn **Dùng tiền còn lại** trên dòng nhận phần chênh. Màn kiểm tra hiển thị chênh dư/thiếu và công nợ sau phân bổ để xác nhận; lịch sử giữ số đối chiếu sau khi tải lại. Không áp ngưỡng 500đ hay tự làm tròn.

- Tổng phân bổ không vượt số tiền ngân hàng. Đơn 100.000đ nhận 100.200đ: ghi thu 100.200đ, công nợ -200đ, hiển thị **Khách trả dư 200đ**. Đơn nhận 99.800đ: ghi thu 99.800đ, còn nợ 200đ. Dòng nào nhận phần chênh do người dùng chọn; không tự chia giữa các đơn.
- Đơn web giữ số thực phân bổ làm bằng chứng thanh toán; công nợ có thể âm để ghi nhận trả dư, nhưng số COD gợi ý không âm.
- Phiếu thu có sẵn khớp tiền: chỉ liên kết. Phiếu lệch tiền: màn xác nhận nói rõ **huỷ phiếu cũ và tạo phiếu đúng thực nhận**, đòi quyền `payments.void` **hoặc** quyền hẹp `sepay.replace-mismatch-receipt` ("Sửa phiếu thu lệch khi đối soát SePay", mặc định không cấp cho ai, Manager bật trong Phân quyền), chặn khi có trả/đổi hàng. Quyền hẹp chỉ dùng trong màn đối soát chi tiết, cần kèm quyền Đối soát khoản thu SePay, không cho huỷ phiếu thu ở nơi khác và không cho gỡ phân bổ. Giữ nguyên nội dung phiếu cũ trong lịch sử huỷ, tạo phiếu mới trong cùng transaction với phân bổ và audit. Không sửa tiền ngân hàng. Gỡ phân bổ này sẽ huỷ phiếu mới; không khôi phục phiếu cũ đã ghi sai.
- Số đối chiếu được lưu trong kết quả lô/nhật ký. Giữ tương thích đọc lô cũ và khoá thử lại. Không tự xoá nợ hoặc hoàn tiền.

Triển khai cần chạy `migrations/postgres/20261125113000_sepay_allocation_overpayment.sql` rồi kiểm gate chỉ đọc `scripts/sql/assert-sepay-overpayment.sql` trước khi phát hành API/UI. Migration chỉ nới ràng buộc `target_total >= amount` thành `target_total >= 0`; các kiểm tra số tiền dương/nguyên/giới hạn, RLS và khoá giao dịch giữ nguyên. Không sửa dữ liệu tiền cũ.

Kiểm thử: `tests/app/sepay-allocation-difference.test.ts`, bộ `sepay-allocations`/`sepay-detail-review`, và `scripts/testing/sepay-difference.mjs` chạy Chromium với API/PGlite qua đúng trang SePay rồi mở công nợ đơn, ở 390/1280px. Dữ liệu thử tách biệt; chưa kiểm chứng giao dịch ngân hàng/CRM thật hoặc nhiều kết nối PostgreSQL thật.


### Rollback mã sau khi đã ghi nhận khách trả dư

Nếu cần rollback API/UI, giữ migration `20261125113000_sepay_allocation_overpayment.sql` và toàn bộ phiếu thu, phân bổ, kết quả lô, nhật ký. **Không khôi phục CHECK `target_total >= amount`**, không giảm số tiền hoặc xoá khoản trả dư để ép schema về bản cũ. Mã cũ có thể chặn thao tác phân bổ dư mới hoặc không hiển thị đầy đủ nhãn trả dư; tạm ngừng luồng ghi bị ảnh hưởng và ưu tiên sửa tiến để khôi phục giao diện công nợ có dấu. Không dùng việc thiếu nhãn ở mã cũ làm căn cứ điều chỉnh số tiền lịch sử.

Migration đã được đăng ký trong `scripts/sql/november-migration-coverage.json`; workflow `deploy-api.yml` chạy gate `assert-sepay-overpayment.sql` ngay sau gate SePay allocations, trước thay đổi secret/API. Gate chỉ đọc, schema cũ phải thất bại; không tự chạy migration để sửa production.
