# Xin hàng trước bằng file — Đơn mua NCC

Manager và Sale Admin mở **Lấy hàng trước → Xin bằng file** (hoặc Xin hàng trước bằng file trong Đơn mua NCC). Nút Tải file mẫu chỉ nằm trong popup nhập file.

1. Bấm **Tải file mẫu** để lấy `mau-xin-hang-truoc.xlsx`.
2. Điền sheet **Xin hàng trước**: **Mã hàng · Số lượng xin trước · Số đơn mua CRM (DMH) · Số đơn của NCC · Số PXK**. Mã hàng là Text (giữ số 0 đầu); app tự lấy tên theo mã, không cần cột tên; số lượng là nguyên dương. Cả hai cột số đơn được để trống. Chỉ nhập số đơn của NCC: tự tìm đơn CRM theo tham chiếu chính xác, mã hàng và NCC đang chọn; nếu khớp nhiều đơn thì chặn và yêu cầu chọn NCC/điền số CRM. Nhập cả hai phải khớp cùng đơn. Trống cả hai: tự phân bổ theo đơn đã duyệt còn đang về. Cùng mã ở nhiều đơn được tách dòng, nhưng không lặp cặp mã + số đơn trong cùng PXK. Số PXK giữ dạng Text. Cùng PXK gom một phiếu dù khác số đơn NCC; khác PXK tách phiếu. Các dòng chưa có số PXK gom riêng thành một phiếu chưa có số. Tối đa 300 dòng, file 2 MB; nhận `.xlsx`, `.xls`, `.csv`.
3. Chọn NCC (hoặc tất cả NCC), ngày lấy, rồi chọn file. Bảng xem trước dùng tên chuẩn theo đơn mua và chỉ rõ dòng thiếu hàng, vượt lượng còn về hoặc ĐVT xung đột; hiện số đơn CRM thực tế được chọn và số đơn NCC. File sai cột, công thức hay số quá dài phải sửa trước; không tự bỏ dòng lỗi để lưu phần còn lại.
4. Bấm **Lưu phiếu nháp**. Bấm **Mở phiếu / Gửi NCC** để kiểm tra/sửa bằng màn hình phiếu hiện có, sau đó chủ động gửi NCC. Lưu file không tự gửi, duyệt, nhận hàng, cộng tồn hay ghi thanh toán.

Tên hàng trong file không tạo sản phẩm mới. Hàng phải có trong đơn mua đã duyệt còn đang về; phần xin chỉ được phân bổ trong phạm vi NCC chọn. Dòng chỉ định nguồn được ưu tiên trước dòng tự phân bổ; không phân bổ trùng lượng trên cùng dòng đơn mua. Sau khi xem trước/lưu, mọi dòng file được ghim vào số đơn CRM thực chọn, kể cả dòng ban đầu để trống số đơn. Đơn đã ghim sai hoặc thiếu lượng sẽ báo lỗi, không chuyển qua đơn khác. Mẫu cũ với tên cột “Lấy ở số đơn hàng nào” / “Số đơn NCC” vẫn đọc được; file chỉ có mã và số lượng cũng hợp lệ. Muốn nhập đơn mua mới từ file NCC vẫn dùng chức năng **Nhập từ file NCC**, không dùng nút này.

## Triển khai source

- UI: `trial-ui/purchase-early-file.js`, nối vào header `purchases.js`; dùng thư viện Excel đã có, chỉ tải khi cần.
- API `/purchase-options` thêm `canRequestEarly`, lấy từ cùng hàm quyền với API nháp. Quyền vẫn được kiểm tra tại server; ẩn nút không phải cơ chế bảo mật.
- Xem trước chỉ GET `/purchase-incoming` theo nhóm 50 mã; lưu dùng POST `/purchase-early-requests/file` theo nhóm PXK; không thêm migration. Tất cả nhóm trong một file được ghi nguyên tử: lỗi một nhóm rollback toàn bộ. API nháp `/purchase-early-requests` cũ giữ hành vi cũ cho các luồng nhập tay. API tự phân giải lại nguồn NCC/nguồn trống dưới khóa transaction, chỉ chấp nhận kết quả xác định. Bộ phân giải dùng chung `src/modules/suppliers/domain/early-order-sources.ts`, sinh thành `trial-ui/early-order-sources.js` bằng `npm run ui:build`. Ràng buộc nguồn lưu trong `scope.orderSources` của phiếu (JSON theo SKU); allocations vẫn liên kết đúng dòng đơn mua hiện có. Khi sửa/gửi, server lấy lại ràng buộc đã lưu; không được mất nguồn do client cũ không gửi metadata. Sửa số lượng ở phiếu nhập file tách theo từng đơn, vẫn gộp một dòng SKU trong DB.
- Retry cùng nội dung dùng cùng `clientKey`. Khi kết quả chưa rõ, khóa nội dung và chỉ thử lại đúng lần lưu; server tra khóa batch và hash nội dung đã lưu trước, trả lại đúng các phiếu đã tạo; khi lưu mới kiểm lại lượng hiện tại và dùng ngân sách chung theo từng dòng đơn mua cho tất cả nhóm PXK. Nếu lượng thay đổi sau khi xem trước, lưu có thể bị từ chối toàn bộ.

## Kiểm thử

`purchase-early-file.test.ts` kiểm tra file Excel thật/CSV, roundtrip mẫu Text, định dạng số, cặp mã + số đơn trùng/cột thiếu/công thức/giới hạn; kiểm quyền, phạm vi NCC, nháp chưa hiện cho NCC và không phát sinh kho/phiếu nhận. `purchase-early-sources.test.ts` kiểm đúng nguồn qua lưu/sửa/gửi, tham chiếu NCC với số 0 đầu, số đơn trùng giữa nhiều đơn CRM, phạm vi NCC, ghim kết quả phân giải, idempotency, nguồn cạn không chuyển sang đơn khác. `early-order-sources.test.ts` kiểm ưu tiên dòng chỉ định nguồn và không phân bổ vượt khi các nguồn chồng nhau. Chạy thêm purchase-early-requests, early-request-manager-ui, early-request-receiving và purchase-restock.

Browser mock kiểm header thật, tải mẫu thật, chọn file, dòng lỗi, tạo nháp và mất kết nối/retry cùng khóa ở 390px/1280px:

```sh
npm install --prefix /tmp/pos-browser playwright
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/purchase-early-file.mjs
```

Cần Chromium tại `/usr/bin/chromium` hoặc đặt `CHROMIUM_PATH`. Playwright không thêm vào dependencies production; script dùng API giả và chặn truy cập ngoài localhost. Chưa kiểm thử iPhone/Safari thật. Không deploy hoặc gửi NCC thật trong phiên phát triển.
