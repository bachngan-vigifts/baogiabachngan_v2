# Xuất kho trong tiến trình đơn POS tại quầy

## Nguyên nhân và sửa

Checkout tại quầy ghi xuất kho trực tiếp với `ref_type=pos_order`, đồng thời đánh dấu giao đủ. Nó không tạo phiếu đóng gói. `progressOf` trước đây chỉ kiểm tra phiếu đóng gói đã xác nhận, nên tiến trình vẫn dừng ở Xuất kho dù hàng đã xuất.

Tiến trình nay nhận thêm chứng từ xuất trực tiếp của đơn `channel=pos`, `fulfillment_mode=counter`, `status=delivered`. Đọc gộp số lượng đơn và số xuất ròng theo từng SKU, kể cả dòng SKU trùng và bút toán đảo. Chỉ tự hoàn tất Xuất kho khi đủ toàn bộ mã/số lượng. Đơn thiếu bằng chứng, xuất thiếu, đảo hết, nháp/chưa giao/huỷ, CRM, COD và ship trả trước không được hoàn tất bằng quy tắc này. Phiếu đóng gói và đánh dấu có quyền vẫn giữ hành vi cũ.

Chỉ sửa cách đọc tiến trình, không ghi tồn, tạo phiếu, cập nhật trạng thái đơn hay ghi dấu thủ công. Áp dụng cho đơn cũ khi tải lại sau triển khai, không backfill/migration.

## Đối chiếu production (chỉ đọc, 22/10/2026)

- POS_20261021_020: đã giao, tại quầy; SKU 015038385V03, số đặt 1, xuất trực tiếp -1, không có phiếu đóng gói.
- Toàn bộ 22 đơn POS tại quầy đã giao đều không có phiếu đóng gói, đều có dòng xuất trực tiếp.
- Đối chiếu tổng số đặt theo SKU với tổng xuất ròng: 0 dòng lệch trên 22 đơn này.
- Không sửa dữ liệu production, không ghi thêm lần xuất.

## Validation

Kiểm thử PostgreSQL cho batch: đủ hàng, thiếu chứng từ, xuất thiếu, đảo hết, sai SKU, huỷ, COD/CRM, SKU trùng, nhiều SKU thiếu một mã, đơn chưa giao, phiếu đóng gói cũ, hàng trả không xoá lịch sử xuất; xác nhận đọc không đổi số dòng/tổng sổ kho. Bộ order-progress cũ đạt, typecheck đạt. Chưa triển khai/live HTTP trong phiên người dùng.
