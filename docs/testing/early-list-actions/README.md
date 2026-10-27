# Huỷ/xoá trên danh sách xin hàng trước

Trước sửa: `#/early-requests` chỉ có link mở chi tiết; nút huỷ/xoá nằm trong chi tiết, phải thêm một lần mở phiếu.

Sau sửa: mỗi thẻ trên danh sách có “Xoá phiếu” với phiếu nháp, hoặc “Huỷ phiếu và xoá” với phiếu đã gửi. Hai lần chạm từ danh sách: bấm nút, xem nội dung xác nhận đầy đủ rồi xác nhận. Không gom nút vào menu ⋮ trên điện thoại.

Dùng lại hộp xác nhận và API DELETE hiện có. Cùng điều kiện Manager như trang chi tiết; kho không thấy nút. Xoá xong tải lại danh sách với nguyên bộ lọc/URL đang xem. Không đổi API/schema/quyền hay tác động tồn kho. Phiếu có lịch sử nhận hàng vẫn bị máy chủ chặn để giữ đối soát.

## Validation

- Typecheck, build UI, diff check: đạt.
- 7 test hiện có: early-request-delete-split, early-request-page, early-request-manager-ui: đạt.
- `PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node --import tsx scripts/testing/early-list-actions.mjs`: đạt ở 390 và 1280px với router thật/PGlite cục bộ.
- Kiểm tra xoá nháp, huỷ/xoá phiếu đã gửi (gồm phiếu nhiều NCC đã đồng ý), chưa ghi DELETE khi chỉ mở/đóng xác nhận, giữ bộ lọc sau xoá, hiện lỗi khi phiếu đã phát sinh nhận hàng, không đổi stock_moves, không lỗi JavaScript/tràn ngang và tài khoản kho không có nút.
- Không thao tác xoá phiếu thật. Toàn bộ test tiếp tục chạy trên CI của PR.
