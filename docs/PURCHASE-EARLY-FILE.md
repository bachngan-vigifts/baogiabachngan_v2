# Xin hàng trước bằng file — Đơn mua NCC

Manager và Sale Admin mở **Đơn mua NCC → Xin hàng trước bằng file**.

1. Bấm **Tải file mẫu** để lấy `mau-xin-hang-truoc.xlsx`.
2. Điền sheet **Xin hàng trước**: **Mã hàng · Tên hàng · Số lượng xin trước · Lấy ở số đơn hàng nào · Số đơn NCC (không bắt buộc)**. Mã hàng là Text (giữ số 0 đầu), tên chỉ tham khảo; số lượng là nguyên dương. Số đơn lấy hàng là số đơn mua trên CRM và bắt buộc. Số đơn NCC có thể để trống; khi nhập phải khớp tham chiếu trên đơn mua. Cùng mã ở nhiều đơn được tách dòng, nhưng không lặp cặp mã + số đơn. Tối đa 300 dòng, file 2 MB; nhận `.xlsx`, `.xls`, `.csv`.
3. Chọn NCC (hoặc tất cả NCC), ngày lấy, rồi chọn file. Bảng xem trước dùng tên chuẩn theo đơn mua và chỉ rõ dòng thiếu hàng, vượt lượng còn về hoặc ĐVT xung đột; hiện rõ cả số đơn lấy hàng và số đơn NCC. File sai cột, công thức hay số quá dài phải sửa trước; không tự bỏ dòng lỗi để lưu phần còn lại.
4. Bấm **Lưu phiếu nháp**. Bấm **Mở phiếu / Gửi NCC** để kiểm tra/sửa bằng màn hình phiếu hiện có, sau đó chủ động gửi NCC. Lưu file không tự gửi, duyệt, nhận hàng, cộng tồn hay ghi thanh toán.

Tên hàng trong file không tạo sản phẩm mới. Hàng phải có trong đơn mua đã duyệt còn đang về; phần xin chỉ được phân bổ trong đúng đơn mua đã chỉ định và phạm vi NCC chọn. Đơn sai hoặc thiếu lượng sẽ báo lỗi, không chuyển qua đơn khác. Muốn nhập đơn mua mới từ file NCC vẫn dùng chức năng **Nhập từ file NCC**, không dùng nút này.

## Triển khai source

- UI: `trial-ui/purchase-early-file.js`, nối vào header `purchases.js`; dùng thư viện Excel đã có, chỉ tải khi cần.
- API `/purchase-options` thêm `canRequestEarly`, lấy từ cùng hàm quyền với API nháp. Quyền vẫn được kiểm tra tại server; ẩn nút không phải cơ chế bảo mật.
- Xem trước chỉ GET `/purchase-incoming` theo nhóm 50 mã; lưu dùng POST `/purchase-early-requests` hiện có, không thêm endpoint ghi hoặc migration. Ràng buộc nguồn lưu trong `scope.orderSources` của phiếu (JSON theo SKU); allocations vẫn liên kết đúng dòng đơn mua hiện có. Khi sửa/gửi, server lấy lại ràng buộc đã lưu; không được mất nguồn do client cũ không gửi metadata. Sửa số lượng ở phiếu nhập file tách theo từng đơn, vẫn gộp một dòng SKU trong DB.
- Retry cùng nội dung dùng cùng `clientKey`. Khi kết quả chưa rõ, khóa nội dung và chỉ thử lại đúng lần lưu; server kiểm lại lượng mới và chống trùng. Nếu lượng thay đổi sau khi xem trước, lưu có thể bị từ chối toàn bộ.

## Kiểm thử

`purchase-early-file.test.ts` kiểm tra file Excel thật/CSV, roundtrip mẫu Text, định dạng số, cặp mã + số đơn trùng/cột thiếu/công thức/giới hạn; kiểm quyền, phạm vi NCC, nháp chưa hiện cho NCC và không phát sinh kho/phiếu nhận. `purchase-early-sources.test.ts` kiểm đúng nguồn qua lưu/sửa/gửi, tham chiếu NCC, idempotency, nguồn cạn không chuyển sang đơn khác. Chạy thêm purchase-early-requests, early-request-manager-ui, early-request-receiving và purchase-restock.

Browser mock kiểm header thật, tải mẫu thật, chọn file, dòng lỗi, tạo nháp và mất kết nối/retry cùng khóa ở 390px/1280px:

```sh
npm install --prefix /tmp/pos-browser playwright
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/purchase-early-file.mjs
```

Cần Chromium tại `/usr/bin/chromium` hoặc đặt `CHROMIUM_PATH`. Playwright không thêm vào dependencies production; script dùng API giả và chặn truy cập ngoài localhost. Chưa kiểm thử iPhone/Safari thật. Không deploy hoặc gửi NCC thật trong phiên phát triển.
