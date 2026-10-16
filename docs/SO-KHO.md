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

## Trang "Sổ kho" (#/inventory) – chỉ Manager
- **Đối chiếu:** tồn sổ kho, tồn Sapo và chênh lệch theo từng mã × kho. Mặc định chỉ hiện các dòng lệch.
- **Thẻ kho:** bấm vào một dòng để xem các phát sinh của mã đó, có tồn luỹ kế và link về chứng từ.
- **Chốt tồn đầu kỳ (Manager):** lấy tồn Sapo hiện tại làm điểm bắt đầu.
  - Hệ thống ghi thêm dòng chênh lệch, không xoá lịch sử.
  - Chốt lại lần nữa khi không có gì đổi thì không ghi thêm dòng nào.
- **Phiếu điều chỉnh (Manager):** dùng cho kiểm kê lệch, hàng hỏng, hàng mẫu…
  - Bắt buộc ghi lý do.
  - Số dương là tăng tồn, số âm là giảm tồn.
  - Mã hàng phải có trong danh mục.

## Giao diện cho tài khoản Kho
Tài khoản kho chỉ thấy các trang cần dùng, chữ to, nút to.
- **Trang kho (#/kho):** trang mở đầu sau khi đăng nhập. Có 3 thẻ lớn: Cần đóng gói · Hàng NCC về – cần nhận · Giao hàng hôm nay, và danh sách việc bên dưới.
- **Thanh dưới trên điện thoại:** Trang chủ · Đóng gói · Nhận hàng · Giao hàng · Tra tồn.
- **Ẩn với kho:** Sơ đồ quy trình, Tổng quan doanh số, Sổ kho (cùng các trang bán hàng như trước).
- **Phiếu đóng gói:** làm theo các bước có đánh số:
  1. tick từng món khi lấy hàng (máy nhớ các món đã tick);
  2. chụp ảnh hàng đã đóng;
  3. chọn kho xuất;
  4. bấm "Đã đóng xong". Nút chỉ bấm được khi đủ cả ba bước trên.
- **Nhận hàng NCC:** trang Đơn mua chỉ hiện các đơn chờ nhận, dạng thẻ. Bấm vào thẻ là mở thẳng form nhận hàng.
  - Mỗi mã một thẻ: "Cần nhận N", ô "Số đạt" / "Số hỏng", nút "Đủ N".
  - Có hàng hỏng thì **bắt buộc 1–3 ảnh**. Manager xem ảnh ngay trên phiếu nhận của đơn mua.
- **Lịch giao hàng:** mặc định hiện hôm nay và ngày mai.
  - Kho **không có nút Huỷ**; máy chủ cũng chặn. Chỉ nhân viên phụ trách hoặc Manager huỷ được chuyến.
  - Bấm "Đã giao" phải chụp 1–3 ảnh hàng đã giao hoặc biên bản ký nhận. Kho bắt buộc chụp, người khác thì tuỳ chọn.
  - Ảnh hiện trên Lịch giao hàng và trên trang đơn.
- **Tra tồn (#/stock-lookup):** cho Kho và Manager. Gõ mã, tên, hoặc quét mã vạch (máy quét cầm tay, hoặc camera trên Chrome Android).
  - Hiện số lượng từng kho thật, **không có giá**.
  - Chưa chốt tồn đầu kỳ thì lấy tồn Sapo; đã chốt thì lấy tồn sổ kho.
- **Lưu ảnh:** ảnh nén ở trình duyệt, lưu trong kho file private (Supabase Storage, thư mục `warehouse-photos/`). Bảng `warehouse_photos` chỉ giữ khoá file.

## Kế hoạch tiếp theo
- **Giai đoạn 2:** chuyển kho giữa các kho, kiểm kê có Manager duyệt, giá vốn bình quân, báo cáo nhập – xuất – tồn theo kỳ.
- **Giai đoạn 3:** chốt tồn đầu kỳ lần cuối, tắt đồng bộ tồn từ Sapo, hệ thống trở thành nguồn tồn chính.

## Kỹ thuật
- **Code:**
  - `src/modules/inventory/`: schema, `api/ledger.ts` ghi phát sinh, `api/photos.ts` ảnh kho, `api/routes.ts` (gồm `GET /inventory/lookup`).
  - Giao diện: `trial-ui/inventory.js`, `trial-ui/kho.js` (Trang kho, Tra tồn).
- **Migration:**
  - `0059_stock_ledger.sql`: 2 bảng mới và cột `packing_slips.stock_warehouse_id`.
  - `0060_supabase_access_stock_ledger.sql`: chặn truy cập trực tiếp qua Data API.
  - `0061_warehouse_photos.sql`: bảng ảnh kho.
  - `0062_supabase_access_warehouse_photos.sql`: chặn truy cập trực tiếp bảng ảnh kho.
- **Test:**
  - `tests/app/inventory.test.ts`: sổ kho và tra tồn.
  - `tests/app/order-progress.test.ts`: phiếu xuất khi đóng gói.
  - `tests/app/purchasing.test.ts`: ảnh hàng hỏng.
  - `tests/app/packing.test.ts`: kho không huỷ chuyến, ảnh đã giao.
