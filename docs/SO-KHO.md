# Sổ kho (giai đoạn 1 – chạy song song với Sapo)

**Mục tiêu:** dần thay Sapo trong quản lý tồn kho.

Ở giai đoạn này **Sapo vẫn là nguồn tồn chính**. Hệ thống ghi một sổ kho riêng và so với tồn Sapo hằng ngày. Khi sổ kho gần như không lệch trong khoảng 1 tháng thì mới chuyển hẳn.

## Nguyên tắc
- **Mỗi phát sinh là 1 dòng** trong `stock_moves`: mã, kho, số lượng +/−, loại, chứng từ gốc, người làm, thời gian.
  - Không ai sửa hay xoá dòng.
  - Huỷ chứng từ thì ghi thêm dòng ngược lại (loại "Huỷ chứng từ").
- **Tồn** nằm trong `stock_balances`, bằng cộng dồn các dòng. Tồn được cập nhật trong cùng giao dịch với chứng từ gốc.
- **Một chứng từ chỉ ghi một lần** cho mỗi (mã, kho, loại). Bấm lặp hay gọi lại cũng không cộng hai lần.
- **Chỉ kho thật** (kho loại `stock`) mới có sổ kho. Kho NCC/ĐL không có.

## Phát sinh tự động
| Chứng từ | Sổ kho |
|---|---|
| Phiếu nhận hàng NCC (số lượng đạt) | **+** vào kho nhận. Kho nhận chọn trong danh sách kho, hệ thống khớp theo tên. |
| Huỷ phiếu nhận NCC | ghi dòng ngược lại |
| Kho xác nhận "đã đóng hàng" (phiếu đóng gói, nguồn = Kho) | **−** khỏi kho xuất. Kho xuất bắt buộc chọn lúc xác nhận. |

**Kho nhận không khớp danh sách kho:** phiếu nhận vẫn được lưu, nhưng sổ kho không ghi. Lịch sử đơn mua có dòng báo "chưa ghi sổ kho". Muốn bù thì Manager lập phiếu điều chỉnh.

## Trang "Sổ kho" (#/inventory) – Manager và nhóm Kho
- **Đối chiếu:** tồn sổ kho, tồn Sapo và chênh lệch theo từng mã × kho. Mặc định chỉ hiện các dòng lệch.
- **Thẻ kho:** bấm vào một dòng để xem các phát sinh của mã đó, có tồn luỹ kế và link về chứng từ.
- **Chốt tồn đầu kỳ (Manager):** lấy tồn Sapo hiện tại làm điểm bắt đầu.
  - Hệ thống ghi thêm dòng chênh lệch, không xoá lịch sử.
  - Chốt lại lần nữa khi không có gì đổi thì không ghi thêm dòng nào.
- **Phiếu điều chỉnh (Manager):** dùng cho kiểm kê lệch, hàng hỏng, hàng mẫu…
  - Bắt buộc ghi lý do.
  - Số dương là tăng tồn, số âm là giảm tồn.
  - Mã hàng phải có trong danh mục.

## Kế hoạch tiếp theo
- **Giai đoạn 2:** chuyển kho giữa các kho, kiểm kê có Manager duyệt, giá vốn bình quân, báo cáo nhập – xuất – tồn theo kỳ.
- **Giai đoạn 3:** chốt tồn đầu kỳ lần cuối, tắt đồng bộ tồn từ Sapo, hệ thống trở thành nguồn tồn chính.

## Kỹ thuật
- **Code:** `src/modules/inventory/` (schema, `api/ledger.ts` ghi phát sinh, `api/routes.ts`) và giao diện `trial-ui/inventory.js`.
- **Migration:**
  - `0059_stock_ledger.sql`: 2 bảng mới và cột `packing_slips.stock_warehouse_id`.
  - `0060_supabase_access_stock_ledger.sql`: chặn truy cập trực tiếp qua Data API.
- **Test:** `tests/app/inventory.test.ts`; phần phiếu xuất khi đóng gói nằm trong `tests/app/order-progress.test.ts`.
