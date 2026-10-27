# Việc cần làm của kho — 3 yêu cầu chung một PR

Nhánh từ main sau PR #334 (`61c7f9b`); không phụ thuộc PR #335 trả hàng CRM.

## Lỗi thực tế

- Sidebar Điều chuyển kho không có badge và `/navigation-counts` chưa trả số điều chuyển. Thao tác điều chuyển cũng chưa thuộc nhóm làm mới dữ liệu/menu sau ghi.
- Luật Công việc đã có điều chuyển. Đối chiếu read-only production thấy 4 phiếu trong ảnh đã có `transfer-move:*` trạng thái todo, nhóm warehouse. Không tạo lại hoặc sửa chứng từ thật. Tuy nhiên API tạo/duyệt/từ chối/huỷ/hoàn tất chưa đồng bộ việc tại sự kiện; phải đợi cơ chế quét Công việc.
- Trang kho chỉ có 3 nhóm, thiếu điều chuyển, phiếu xin hàng trước và phiếu nhận chờ Sapo. Giao hàng chỉ lấy 7 ngày gần đây, bỏ sót giao lỗi và chuyến trễ lâu hơn. Tên sidebar/breadcrumb còn là Trang kho.

## Thay đổi

1. **Điều chuyển:** badge đếm toàn bộ pending + approved trước giới hạn danh sách. Dùng cùng phạm vi kho active/kho riêng cho badge và dashboard. Sau giao dịch phiếu, đồng bộ riêng các việc của phiếu đó, không quét/đóng việc không liên quan. Duyệt chuyển từ việc duyệt sang việc nhóm Kho; done/reject/cancel tự đóng. Giữ luật giao người/nhóm và quyền ghi tồn hiện có. Lỗi đồng bộ việc không rollback chứng từ; cơ chế quét việc cũ vẫn dự phòng.
2. **Việc của kho:** endpoint read-only `/warehouse-work` tổng hợp 6 thẻ: đóng gói; nhận NCC; giao hôm nay/quá hạn/giao lỗi; điều chuyển; phiếu xin trước; phiếu nhận chờ nhập Sapo. Count tính trước preview/pagination. Mỗi danh sách xem nhanh tối đa 6 dòng, mở đúng chứng từ. Phiếu xin đã gửi, pending/accepted còn nguồn hàng mới là việc chờ; loại nháp/rejected/deleted/đã nhận đủ, tính nhận một phần bằng provenance hiện có. Không cộng lượng đơn mua và phiếu xin vào một tổng. Giao lỗi/chuyến trễ cũ có link `deliveryId` chính xác, không lẫn POS.
3. **Đổi tên:** sidebar, breadcrumb, tiêu đề trang thành **Việc cần làm**. Có Làm mới hiện trực tiếp, tự quản lý trạng thái bận; giữ focus/form điều chuyển khi nền làm mới. Đồng bộ số đếm sau thao tác chuyển kho hoặc thay đổi phiếu xin hàng.

Các mục bị tắt quyền trả null và không hiện trên dashboard; không gửi giá/tiền NCC. Không thêm quyền, schema, dependency hoặc đổi công thức tiền, cách xuất/nhập, Sapo/GHN/cron. Chỉ đọc trạng thái phiếu nhận Sapo; không tự retry/gọi tích hợp.

Liên kết lịch nhận hỗ trợ `type=purchase|early` và `workOnly=1` có chú thích trên giao diện; lịch bình thường giữ hành vi cũ. Nút chờ Sapo mở đúng chip Sapo; lọc Sapo trên server trước limit để tìm được phiếu cũ sau hơn 300 đơn mới, giữ metadata đếm các chip khác.

## Kiểm tra

- Typecheck, build UI, diff check đạt.
- 63 test liên quan (3 mới + 60 hồi quy): chu trình điều chuyển và đóng việc ngay không cần mở Công việc; không đóng việc khác; chỉ ghi 2 bút toán ở bước Đã chuyển; scope kho riêng/không active; count hơn 300 phiếu; quyền từng loại việc; phiếu xin nháp/từ chối/xoá, nhận từng phần/đủ; receipt Sapo lỗi; chuyến giao lỗi cũ; lọc Sapo trước giới hạn; các API công việc, mua hàng, lịch kho và tồn hiện có.
- Browser router thật/PGlite **360/390/430/768/1280px**: 6 thẻ; badge điều chuyển=4; tên mới; mở đúng phiếu điều chuyển, chuyến giao, lọc xin trước và Sapo; 5 lần Làm mới không nhân đôi; không lỗi JS/tràn ngang. Browser chỉ gửi GET, không thao tác nghiệp vụ production. [Kết quả](results.json).
- Đã chạy lại đủ 63 test liên quan trên base main mới sau rebase: 63 đạt, 0 lỗi. Toàn bộ repo do CI của PR kiểm tra.

[Điện thoại 390](home-390.png) · [Desktop 1280](home-1280.png).

Chưa merge/deploy. Không tạo, chuyển kho, nhận hàng hoặc huỷ phiếu thật.
