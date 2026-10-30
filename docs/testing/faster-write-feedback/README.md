# Phản hồi nhanh sau thao tác ghi — bước 1–2

Đợt này tối ưu hiển thị sau khi máy chủ xác nhận và sửa mã gửi lại cho **giao việc thủ công**. Chưa có hàng đợi IndexedDB, `client_commands`, `outbox_events`, worker hay migration. Không chạy lệnh lên production, không triển khai.

## Thay đổi và giới hạn tốc độ

| Thao tác | Cách cập nhật | Lượt HTTP nối tiếp tránh được |
| --- | --- | --- |
| Ký HĐKT, huỷ phiếu thu | API trả chi tiết đơn theo cùng quyền đọc; giao diện dùng phản hồi đó | 1 lượt GET đơn |
| Gửi trao đổi trong việc kế toán | API trả bình luận đã lưu; thêm bằng DOM text, giữ nội dung đang gõ tiếp | 2 lượt GET chi tiết việc và bình luận |
| Manager xác nhận lô xin lấy trước | Trả các phiếu đã đổi, gồm số liệu nhận hàng; cập nhật đúng phiếu | 1 lượt GET phiếu con; trang cha vẫn tải nền |
| Đổi trạng thái việc | Trả bản việc có quyền, phiên bản và tên từ máy chủ; cập nhật dòng trước | Không xoá GET danh sách; chuyển tải số đếm/bộ lọc sang nền |
| Duyệt kiểm kê/cân bằng | Cập nhật trạng thái dòng sau phản hồi xác nhận, rồi tải lại tồn/danh sách nền | Không bỏ bước tải tồn; lỗi tải lại không bị báo thành lỗi duyệt |

Với giả định 0,8 giây/lượt HTTP, có thể giảm khoảng 0,8 giây cho một lượt đọc nối tiếp, khoảng 1,6 giây cho hai lượt đọc nối tiếp. Đây là ước lượng theo số lượt mạng, **chưa đo production**. Phần truy vấn tạo chi tiết vẫn chạy ở máy chủ; không hứa giảm thời gian CSDL tương ứng. Không cộng các request chạy song song.

Các dữ liệu trả thêm được bật bằng `returnDetail`, `returnTask`, `returnRequests`; client/API cũ vẫn có đường tải lại. Lỗi đọc phần chi tiết tùy chọn không biến nghiệp vụ đã commit thành ghi thất bại. Phản hồi phiên cũ không cập nhật phiên hoặc dữ liệu của người vừa đăng nhập.

## Gửi lại và xung đột

- Tạo việc trong trang Công việc và trong Chat dùng UUID theo lần thao tác. Đóng/mở hoặc tải lại tab khi chưa rõ kết quả khôi phục payload và mã cũ; nội dung khác bị chặn. Hai lần tạo giống nhau đã được xác nhận có hai mã khác nhau. Không tự gửi nền.
- Mã được tách theo tài khoản và vị trí giao việc trong sessionStorage, có bản nhớ nếu storage bị chặn. **Không phải lưu bền vững outbox**: đóng tab/xoá storage có thể mất mã; không bảo đảm chống một thao tác người dùng thực hiện độc lập ở hai tab.
- POST tasks so đủ trường tạo khi gặp lại mã: tiêu đề, mô tả, người/nhóm nhận, ưu tiên, ngày/giờ hạn, link. Vẫn so với dòng việc hiện tại, chưa có biên nhận payload gốc bất biến: nếu việc đã được sửa sau khi tạo, replay có thể trả 409. Thông báo vẫn theo cơ chế cũ, chưa có bảo đảm gửi sự kiện bền vững.
- Ghi chú khách nhận ra trạng thái vừa áp dụng bởi cùng người, cùng nội dung và đúng một phiên bản tiếp theo. Không thay thế chống trùng theo mã lệnh.
- Đánh dấu hẹn chăm sóc gửi revision và ngày hẹn; máy chủ compare-and-set, xung đột không ghi đè. Client cũ chưa gửi revision vẫn được hỗ trợ; cần metadata từ client mới để phát hiện lịch trên màn hình đã cũ.
- Không thay `request-keys.js` của các khoản thu/chi/nhận hàng. Các rủi ro mã theo nội dung ở những luồng đó chưa được giải quyết trong đợt này. Tiền, kho và duyệt luôn chờ máy chủ.
- Không sửa lương/chấm công, phiên Sapo, cron hay đồng bộ Sapo.

## Xác minh

Kiểm thử dùng router thật với Postgres WASM/PGlite và dữ liệu giả. Không kết nối CSDL ngoài. Test trình duyệt chặn mọi origin ngoài máy chủ local.

- API: cùng mã gửi đồng thời/gửi lại; khác nội dung; trả đúng chi tiết đơn sau huỷ và khi replay; quyền NCC bị từ chối; trả đủ số liệu phân bổ sau xác nhận lô.
- CAS: ghi chú cùng người/khác người; lịch hẹn đổi ngày hoặc revision, replay không tăng phiên bản.
- UI: trao đổi không tải lại chi tiết, không dùng HTML từ server, giữ nội dung gõ mới; bộ lọc/cache công việc, phiên đăng nhập, transport không tự gửi lại lệnh ghi, kiểm kê/duyệt kho.
- Chromium 1280px và 390px: giả lập mất phản hồi **sau khi API đã commit**, gửi lại cùng mã chỉ có một việc; lần tạo hợp lệ tiếp theo có mã khác. Desktop tải lại tab rồi khôi phục mã; mobile đóng/mở form. Huỷ phiếu thu cập nhật từ phản hồi ghi, **0 GET đơn bổ sung**, không có lỗi JS.

Chạy browser: `PLAYWRIGHT_MODULE=<đường dẫn module Playwright> node --import tsx scripts/testing/faster-write-feedback.mjs`. Script cần Chromium tại `/usr/bin/chromium`; ảnh và kết quả đầy đủ ở `/workspace/scratch/faster-write-feedback`.

Typecheck: `npm run typecheck`. Trong môi trường có lỗi native WASM của test worker, dùng `node --import tsx --test --test-isolation=none --test-reporter=spec <các file test>`.

[Chi tiết kết quả browser](results.json) · [Ảnh đơn sau xác nhận trên mobile](confirmed-order-390.png).

## Bước tiếp theo

Outbox cho chat chữ/bình luận cần PR riêng: biên nhận chống trùng và sự kiện cùng transaction, migration chạy tay, IndexedDB ghi bền trước khi gửi, account isolation, Web Locks, phụ thuộc, tương thích phiên bản và giao diện lệnh cần xử lý. Không đưa tiền/tồn/duyệt/tích hợp ngoài vào hàng đợi. Chưa thể hứa không mất lệnh khi dữ liệu chỉ nằm trên thiết bị bị xoá.
