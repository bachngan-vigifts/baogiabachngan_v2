# Đối soát tỷ lệ huỷ đơn web → GHN

## Kết luận và giới hạn

Kiểm tra ngày 31/10/2026 bằng truy vấn tổng hợp chỉ đọc trong CRM, không lấy thông tin cá nhân:

- Web Lock: 60 đơn `cancelled` (52 có GHN `cancel`, 8 chưa có trạng thái GHN), 1 `trash` còn GHN `ready_to_pick`, 2 `processing`/`ready_to_pick`.
- Không có dòng Web Lock thành công trong bảng CRM đã nhận. Vì vậy 61/61 là phép chia đúng theo phân loại cũ, **không chứng minh website thực sự huỷ 100%**. Một đơn đã xoá cũng không đủ bằng chứng giao thất bại.
- Đơn POS/CRM giao thành công không có liên kết nguồn web đủ để cộng vào mẫu web. Không ghép theo tên khách hoặc tự suy đoán.
- Chưa đối chiếu toàn bộ đơn trên website/GHN. Không gọi POST refresh (có tác dụng ghi), không backfill hoặc sửa dữ liệu production.

Bản handoff `handoff/lock-ghn-wordpress/README.md` và các snippet 71/125 dùng trạng thái `lnl-delivered` khi đã giao nhưng chưa xác nhận COD; cùng các trạng thái lấy hàng, giao lại và hoàn. Đây là bằng chứng định dạng trong code, **không xác nhận phiên bản snippet đang chạy trên website**. CRM trước đây thiếu ánh xạ các trạng thái riêng khi không kèm metadata GHN. Không kết luận thiếu ánh xạ là nguyên nhân duy nhất của dữ liệu hiện tại.

## Thay đổi

- Ánh xạ trạng thái web → GHN riêng vào bảng đơn và các chốt hành động hiện có. Giao thất bại có thể giao lại vẫn ở nhóm đang giao; giao thành công không đồng nghĩa đã thu tiền. Giữ ưu tiên dữ liệu GHN và quy tắc hoàn tiền/xoá như trước.
- Loại `trash` khỏi tỷ lệ đánh giá quảng cáo, hiện rõ số loại; giữ nguyên danh sách và số vận hành để đối soát.
- Với ít nhất 30 đơn kết thúc nhưng chưa ghi nhận đơn web thành công nào, hiện “Cần đối soát dữ liệu web → GHN”, giữ nguyên tỷ lệ số học, không đề nghị cắt ngân sách. Đây là tín hiệu cần kiểm tra, không khẳng định dữ liệu sai.
- Không thay đổi đường đồng bộ, tồn kho, thu tiền, Sapo, GHN hay ngân sách quảng cáo. Không migration.

## Kiểm chứng

- `npm run typecheck`.
- `node --import tsx --test --test-isolation=none tests/app/pos-order-board.test.ts tests/app/pos-ui.test.ts`: 38/38.
- Kiểm thử API/PGlite: đơn web giao trực tiếp, trạng thái tùy chỉnh, chưa có bằng chứng thu tiền, loại đơn xoá và phân nhóm hoàn hàng.
- `scripts/testing/web-order-outcome.mjs`: Chromium thật, 1280px/390px, module POS thật, dữ liệu giả và chặn mọi request ngoài máy. Banner và cửa sổ chi tiết đều yêu cầu đối soát, không có cảnh báo ngân sách đỏ; không lỗi JavaScript.

Cần đối soát tiếp bộ đơn gốc website → GHN với CRM trước khi đánh giá hiệu quả quảng cáo. PR này không tự tạo các đơn thành công còn thiếu.
