# #801 · Việc 1 B2 · Projections ngoài module mua hàng

Phụ thuộc B1 #812; nhánh PR dùng base của B1 trong lúc B1 chưa merge. Không có migration mới.

## Trước / sau

Test trên origin/main c37c9683: `/inventory/lookup` của Sale trả `PO-a1` và tên NCC; test chống lộ số PO thất bại. B2 truyền viewer qua incoming reader ở inventory/POS/quote/catalogue. Manager/Kế toán có quyền trang giữ chi tiết. Sale Admin chỉ tổng/chi tiết NCC được gán hãng. Vai trò bị chặn vẫn nhận tổng SL và ngày hẹn gần nhất trong một bucket vô danh, không giữ ID/số đơn/số NCC/tên NCC. Không giả ID nguồn.

Danh mục/snapshot/thông tin sản phẩm chiếu lại kho incoming cho Sale Admin; không ghi lại `product_stock`. Đổi cấu hình hãng đổi variant cache, tránh `unchanged` hoặc phục hồi snapshot của phạm vi cũ. Các lô snapshot được đọc lần lượt theo tối đa300 SKU/lần. Worker/source budget/giữ hàng/tồn vật lý vẫn dùng dữ liệu toàn cục như trước.

Product hub chặn nhóm chứng từ mua với vai trò ngoài trần; counts/early áp SQL scope trước phân trang, phiếu early trộn ngoài scope không lọt qua join một dòng. Liên kết trên đơn/khách dùng cùng purchaseScope của B1, có test hồi quy.

Lịch sử sản phẩm và sổ kho giữ số lượng/ngày/tồn trước-sau. Ẩn refCode/refNo/link/NCC/ghi chú của nguồn mua không được xem; không đoán quyền từ tên. Link ngoài CRM không chứng minh hãng được phép của Sale Admin. Tìm kiếm refNo/note trên sổ kho kiểm scope trước count/pagination, không để dò tên chứng từ bị ẩn. Không đổi sổ kho hoặc công thức tiền.

## Kiểm chứng

- Fixture kiểm tổng 20.000 vs15.000 theo phạm vi, thu hồi hãng đổi cache, bất biến kho materialized.
- Kiểm inventory, backend POS, catalogue, history/stock move, query dò chứng từ, order/customer links và mixed early.
- Test positive cũ tạo PO bằng Manager hoặc chức vụ mua hợp lệ; kiểm âm Sale không được mở chứng từ. Kế toán bị tắt quyền giá vẫn không nhận số tiền qua product hub.
- Chromium sản phẩm thật trên API/PGlite ở360/390/430/768/1280: tab/chuyển trang/link canonical/rollback lỗi đọc, Sale không có tab mua/nhận/early, Sale Admin390/1280 không thấy PO hãng bị gỡ; không có JS error/overflow hoặc ghi nghiệp vụ. Đã sửa chỗ đợi tab ledger trong script để đợi link đích thay vì count cũ bằng nhau.

## Chờ phối hợp / triển khai

B1 còn nháp và CI toàn repo đang được xử lý; không coi B2 sẵn sàng triển khai độc lập. Đã báo CẦN PHỐI HỢP trên #801: frontend `trial-ui/pos.js` của #811 luôn dựng nút mở PO cho incoming bucket không có orderId. Codex-3 không sửa file này. API không trả ID bí mật để né nút sai.

Sau review: B1 migration/assert trước API B1+B2 rồi UI tương ứng. B2 không cần migration. Rollback bằng revert PR B2/API/UI về phiên bản đã kiểm chứng; giữ schema nullable của B1. Revert sẽ phục hồi cách hiển thị metadata rộng trước B2, cần cân nhắc rủi ro truy cập. Không rollback riêng B1 khi B2 còn dùng policy/schema.

Chưa kiểm CRM production, Safari/thiết bị thật hoặc PostgreSQL nhiều kết nối. Không gửi email/push/call Sapo/GHN/SePay/Drive thật. Không sửa `trial-ui/pos*.js`, không sửa SePay.
