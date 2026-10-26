# Kho, duyệt điều chỉnh và thao tác nhanh — 26/10/2026

## 1. Tồn 542 nhưng xuất 300 báo thiếu

Đối soát production chỉ đọc cho SKU **071588000**, đơn **DH_005_23102026** (`6f9e07a3-7a49-4ddf-9a81-7ee8ec1f0eae`):
- KHO VIGIFTS: cả snapshot Sapo và sổ kho CRM đều 542. Cửa hàng Cần Thơ: 28. Hàng chờ về: 500.
- Đơn đang confirmed, giữ 300 tại VIGIFTS, chưa giao; chỉ có bút toán opening cho SKU, chưa có xuất thực tế. Phiếu DG cũ đã huỷ.
- Hộp chia nguồn cũ lấy tổng tồn rồi trừ các giữ hàng, gồm cả 300 của chính đơn. Với số liệu này, tổng 570 trừ 300 chỉ còn 270 và gây cảnh báo thiếu giả.

GET packing nay trả tồn khả dụng của đúng kho bán, dùng nguồn tồn CRM khi kho đã chốt, trừ phần giữ cho đơn khác và loại trừ chính đơn. Không lấy hàng chờ về/kho khác bù tồn xuất. UI hiển thị kho và cách tính. Nhánh đơn cũ đã xuất khi duyệt giữ xử lý tương thích; xác nhận xuất vẫn khoá sổ kho và từ chối tồn âm.

Không tự điều chỉnh tồn, khôi phục phiếu huỷ, tạo phiếu mới hay xuất lại đơn production này.

## 2. Phiếu điều chỉnh của nhân viên

- Nhân viên có `inventory.view` + `inventory.manage` gửi yêu cầu **pending**; chưa có stock move, chưa đổi tồn. Quyền lập không đồng nghĩa quyền duyệt.
- Chỉ role Manager được approved/rejected. Duyệt khoá phiếu, ghi toàn bộ stock moves và trạng thái/actor/audit trong cùng transaction. Thiếu tồn: rollback và phiếu vẫn pending. Từ chối cần lý do, không đổi tồn.
- Stable client key theo người gửi + payload hash chống gửi lại/trùng. Hai lượt duyệt đồng thời chỉ ghi một lần; trạng thái đã xử lý không đổi quyết định.
- Manager tự lập vẫn ghi và duyệt ngay như API cũ. Form mới luôn gửi client key; client Manager cũ không có key vẫn tương thích.
- Danh sách/trang xem ghi số phiếu, kho, người lập, lý do, các dòng, người/thời điểm xử lý. Nhân viên chỉ xem phiếu của mình trong phạm vi kho; Manager xem/duyệt trong phạm vi hợp lệ. Có thông báo nội bộ cho Manager/người lập.
- Bảng mới `inventory_adjustments`: RLS bật, không có policy công khai; revoke PUBLIC/anon/authenticated, chỉ backend truy cập.

## 3. Thẻ tiến trình và số chứng từ

Thẻ có số báo giá/đơn/HĐKT, phiếu xuất DG, chuyến giao GH để mở nhanh. Manager/Sale Admin có lối tắt tới thao tác thật: duyệt/gửi duyệt theo quyền hiện hành, lập phiếu xuất, mở phiếu để xác nhận, cập nhật chuyến giao. Sale Admin được đánh dấu In mẫu/Sản xuất (ghi actor) sau điều kiện xuất kho; không được dùng progress API để giả Duyệt/Xuất/Giao hoặc hoàn thành tất cả. Các guard physical export giữ nguyên.

## 4. Xác nhận giao thay kho

- Manager, Kho, Sale Admin hoặc nhân viên phụ trách đơn có thể cập nhật chuyến trong phạm vi được xem. Người có quyền đọc rộng nhưng không phụ trách không được ghi.
- `confirmed_by/at/status` lấy từ session và đồng hồ server, bỏ qua thông tin actor do client gửi. Audit trạng thái trước/sau cùng transaction với cập nhật số lượng giao/đơn.
- Lịch giao và chi tiết đơn hiện tên, trạng thái xác nhận, thời điểm. Phiếu cũ chỉ đọc actor từ dispatch audit đã commit có trạng thái tương ứng; không suy đoán người lập là người xác nhận.
- Không nới điều kiện kho/ảnh/GHN. GHN vẫn do hãng quản lý trạng thái; xuất đủ đúng kho vẫn là điều kiện trước bàn giao/đã giao; cập nhật trùng không cộng giao lần hai.

## Triển khai và xác minh

Migration CLI tạo: `migrations/postgres/20261026042035_inventory_adjustment_approval.sql`, được ghép vào workflow API trước deploy. Thêm bảng yêu cầu điều chỉnh và ba cột xác nhận giao hàng/index; không sửa dữ liệu chứng từ cũ. API trước UI theo release gate hiện có.

Đã kiểm thử typecheck/UI build; PGlite 542/300, giữ của đơn khác/kho khác, thiếu thực không xuất; pending/approve/reject, chống trùng và rollback; quyền owner/Sale Admin/read-only, chống giả actor, dependency kho và progress, fallback audit cũ. Chromium 390/1280 dùng router thật/PGlite đi qua cả bốn luồng. Hồi quy inventory, warehouse-sales, packing, progress, deliveries và POS.

Chưa deploy trong tác vụ; không retry GHN/Sapo hoặc thay stock/order production để thử.
