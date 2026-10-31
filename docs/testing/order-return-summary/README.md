# Hiển thị giao hàng và nhận hoàn trên chi tiết đơn CRM

Kiểm tra ngày 31/10/2026. Chỉ đọc hẹp đơn được chủ doanh nghiệp yêu cầu; không ghi dữ liệu thật, không gửi lại phiếu hoàn hay cộng kho lần nữa.

## Kết quả đối chiếu

Đơn `DH_20261014_002`: trạng thái lưu là `delivered`; hai mã `09566`, `22566` đều có số đặt 2, đã giao 2. Phiếu `TH-CRM-1D167B5F` đã nhận hoàn và nhập lại kho 1 bộ mỗi mã; sổ kho có đúng hai dòng nhập hoàn +1. Vì vậy khách đang giữ 1 bộ mỗi mã.

Cảnh báo thiếu chứng từ xuất kho lịch sử đang che trạng thái giao thực tế; tiến trình hiển thị “Chưa tới” ở bước giao hàng. Đơn được giao trước ngày chốt tồn. Căn cứ nhận hoàn trước chốt tồn chỉ chứng minh quyền nhập lại lượng hoàn, không chứng minh đã đối soát toàn bộ lần xuất gốc.

## Thay đổi

- Giữ nguyên trạng thái đã lưu; hiện riêng nhãn nhận hoàn và cảnh báo đối soát xuất kho.
- Bước giao hàng thể hiện đã ghi nhận giao, vẫn giữ chốt xuất kho chưa hoàn tất.
- Bảng hàng thêm số đã nhận hoàn / nhập lại kho / khách đang giữ khi có phiếu trả; không giảm lịch sử đã giao.
- Hiện lịch sử phiếu trả, thời điểm, kho thực nhận, chi tiết từng mã; bấm số phiếu mở quy trình trả hàng hiện có.
- Phiếu đang chờ chưa tính là đã nhận; hàng hỏng không tính nhập tồn bán; phiếu huỷ chưa nhận không làm giảm lượng khách giữ.
- Quyền kiểm tra qua đơn cha trước khi đọc chi tiết. Không thay đổi tài chính, bút toán tồn, điều kiện xuất/giao hoặc phê duyệt. Không migration.

## Kiểm thử

- `npm run typecheck`: đạt.
- 33 test đạt: projection nhận hoàn, trình bày dòng đơn/POS, giữ chốt xuất kho cũ, quy trình trả hàng, căn cứ nhập lại, tài chính trả hàng, tiến trình đơn, kiến trúc, cấu trúc trang.
- Kiểm tra lại 3 test trình bày sau khi bổ sung nhãn cột cho điện thoại: đạt.
- `scripts/testing/order-return-summary.mjs`: Chromium thực, API/router thật và PGlite, hai độ rộng 1280 và 390 px. Xác nhận hai dòng 2 / 2 / 1 / 1 / 1; trạng thái đã giao + nhận hoàn một phần; cảnh báo đối soát vẫn giữ; mở được chi tiết phiếu trả; không lỗi JS hoặc tràn ngang trang. Các lần đọc/mở phiếu không đổi số dòng hay tổng lượng sổ kho.
- Ảnh và JSON kèm theo chỉ dùng dữ liệu giả lập. Mọi kết nối ngoài máy thử bị chặn.

Bản sửa cần được merge và triển khai trước khi CRM thật đổi giao diện.
