# Xin hàng trước bằng file — Đơn mua NCC

Manager và Sale Admin mở **Đơn mua NCC → Xin hàng trước bằng file**.

1. Bấm **Tải file mẫu** để lấy `mau-xin-hang-truoc.xlsx`.
2. Điền sheet **Xin hàng trước**: **Mã hàng · Tên hàng · Số lượng xin trước**. Mã hàng là Text (giữ số 0 đầu), tên chỉ tham khảo; số lượng là nguyên dương. Không lặp mã. Tối đa 300 dòng, file 2 MB; nhận `.xlsx`, `.xls`, `.csv`.
3. Chọn NCC (hoặc tất cả NCC), ngày lấy, rồi chọn file. Bảng xem trước dùng tên chuẩn theo đơn mua và chỉ rõ dòng thiếu hàng, vượt lượng còn về hoặc ĐVT xung đột. File sai cột, công thức hay số quá dài phải sửa trước; không tự bỏ dòng lỗi để lưu phần còn lại.
4. Bấm **Lưu phiếu nháp**. Bấm **Mở phiếu / Gửi NCC** để kiểm tra/sửa bằng màn hình phiếu hiện có, sau đó chủ động gửi NCC. Lưu file không tự gửi, duyệt, nhận hàng, cộng tồn hay ghi thanh toán.

Tên hàng trong file không tạo sản phẩm mới. Hàng phải có trong đơn mua đã duyệt còn đang về; phần xin được phân bổ trong phạm vi NCC chọn, theo quy tắc hiện có. Muốn nhập đơn mua mới từ file NCC vẫn dùng chức năng **Nhập từ file NCC**, không dùng nút này.

## Triển khai source

- UI: `trial-ui/purchase-early-file.js`, nối vào header `purchases.js`; dùng thư viện Excel đã có, chỉ tải khi cần.
- API `/purchase-options` thêm `canRequestEarly`, lấy từ cùng hàm quyền với API nháp. Quyền vẫn được kiểm tra tại server; ẩn nút không phải cơ chế bảo mật.
- Xem trước chỉ GET `/purchase-incoming` theo nhóm 50 mã; lưu dùng POST `/purchase-early-requests` hiện có, không thêm endpoint ghi hoặc migration.
- Retry cùng nội dung dùng cùng `clientKey`. Khi kết quả chưa rõ, khóa nội dung và chỉ thử lại đúng lần lưu; server kiểm lại lượng mới và chống trùng. Nếu lượng thay đổi sau khi xem trước, lưu có thể bị từ chối toàn bộ.

## Kiểm thử

`purchase-early-file.test.ts` kiểm tra file Excel thật/CSV, roundtrip mẫu Text, định dạng số, mã trùng/cột thiếu/công thức/giới hạn; kiểm quyền, phạm vi NCC, nháp chưa hiện cho NCC và không phát sinh kho/phiếu nhận. Chạy thêm purchase-early-requests, early-request-manager-ui, early-request-receiving và purchase-restock.

Browser mock kiểm header thật, tải mẫu thật, chọn file, dòng lỗi, tạo nháp và mất kết nối/retry cùng khóa ở 390px/1280px:

```sh
npm install --prefix /tmp/pos-browser playwright
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/purchase-early-file.mjs
```

Cần Chromium tại `/usr/bin/chromium` hoặc đặt `CHROMIUM_PATH`. Playwright không thêm vào dependencies production; script dùng API giả và chặn truy cập ngoài localhost. Chưa kiểm thử iPhone/Safari thật. Không deploy hoặc gửi NCC thật trong phiên phát triển.
