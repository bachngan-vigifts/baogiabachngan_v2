# Trang ghi nhận thanh toán SePay

## Quyền và phạm vi

Mở **Tiền & công nợ → Thanh toán SePay** (`#/sepay`); điện thoại vào nhóm **Tiền** ở menu chân trang. Manager và Kế toán được xem danh sách, chứng từ gốc và lịch sử xử lý. Chỉ Manager được tìm đơn/HĐKT, xem trước cách ghi nhận và xác nhận. API kiểm tra quyền độc lập với giao diện.

Trang hiển thị giao dịch tiền vào đã được webhook CRM lưu trong `sepay_transactions`. Trang không tải sao kê lịch sử trực tiếp từ ngân hàng. Dùng migration và cấu hình tài khoản đã có trong [luồng nhận webhook](SEPAY-RECEIPTS.md); phần trang không thêm migration hay tự cấu hình webhook.

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
