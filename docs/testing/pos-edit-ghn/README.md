# Sửa sản phẩm POS trước khi GHN lấy hàng

Cho Manager thêm/xoá sản phẩm, đổi số lượng và giá trên đơn POS COD có vận đơn GHN ở trạng thái `ready_to_pick` hoặc `picking`. Giữ nguyên mã vận đơn. Các chặn đã thanh toán, đã xuất kho, đã lấy hàng, trả hàng và giao nhiều đợt vẫn áp dụng.

## Đồng bộ và phục hồi

- CRM xác thực tồn, giá, quyền và trạng thái trước khi chuẩn bị lần sửa. Lưu ý định sửa trong JSON `posSnapshot`, giữ cả lượng hàng cũ và lượng tăng thêm của hàng mới.
- Gọi GHN ngoài transaction kho/tiền. Cập nhật `items`/`content` qua `/update`, sau đó COD qua `/updateCOD`. Đọc lại `/detail` để xác minh trước khi ghi sản phẩm, lịch thu và COD trên CRM.
- Khoá thao tác lặp bằng request key, revision và lease. Trong lúc chưa hoàn tất, chặn thu tiền, đóng gói, xuất/giao và áp dụng callback GHN cho đơn này.
- Nếu mất phản hồi hoặc ghi CRM thất bại, giữ lần sửa. Đóng/mở lại trang rồi bấm **Tiếp tục cập nhật GHN** để đối chiếu và làm tiếp phần thiếu. Không tạo vận đơn mới.
- Chỉ cho bỏ lần sửa trước khi từng gửi yêu cầu ghi GHN. Khi đã gửi nhưng chưa rõ kết quả, phải tiếp tục đối chiếu.
- Không thêm migration hay secret. Không thay cron hoặc phiên Sapo.

## Giới hạn API đã đối chiếu

Tài liệu chính thức: [Update order](https://developer.ghn.vn/en/docs/order/update), [Update COD](https://developer.ghn.vn/en/docs/order/update-cod).

`/update` cho sửa hàng khi chờ lấy hàng; sửa COD qua endpoint này yêu cầu OTP. Luồng dùng `/updateCOD` với đúng hai trường `order_code`, `cod_amount`, không OTP; giới hạn đổi COD 5.000.000 đồng. Đơn vượt mức này không tự gửi thay đổi COD. Địa chỉ/người nhận vẫn theo các chặn hiện có của form.

## Bằng chứng kiểm tra

- `tests/app/pos-ghn-edit.test.ts`: thêm/xoá hàng, giữ tồn cũ và mới khi chờ GHN, checkout cạnh tranh, request lặp, chặn thanh toán/đóng gói/callback, lỗi COD một phần, mất phản hồi, lỗi commit CRM, tiếp tục sau khi tải lại và xuất đúng hàng mới một lần.
- `tests/app/pos-order-edit-ui.test.ts`: trạng thái chờ lấy hàng được sửa, hàng đã lấy bị khoá, phục hồi lần sửa chờ.
- `scripts/testing/pos-edit-ghn.mjs`: trình duyệt thật 1280px và 390px, tài khoản quầy Minh Long mô phỏng; backend integration dùng quầy Lock mô phỏng. Không gọi GHN hoặc sửa đơn thật.
- [Kết quả trình duyệt](results.json), [form điện thoại](edit-390.png), [trạng thái chờ sau tải lại](pending-reload.png).

Typecheck và ca integration mới chạy riêng đã qua. Sáu tệp hồi quy (`contract-amendments`, `pos-order-edit-ui`, `pos-order-edit`, `pos-order-products`, `pos-ghn-sync`, `trial-ui`) đã qua. Test `pos-ghn-create` được cập nhật kỳ vọng cho luồng sửa mới: thiếu request key thì không đổi hàng; đổi địa chỉ riêng vẫn bị chặn.

Môi trường Node 24.19.0 có lỗi native V8/WASM (`UnregisterWasmAllocation`) khi dùng test worker. Chạy hai tệp GHN với `--test-isolation=none --test-reporter=spec` để nhận kết quả assertion đầy đủ. Không thay runtime ứng dụng hoặc cấu hình test chung của repository.
