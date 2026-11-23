# Gộp nguyên trang Catalogue

Chọn 2–20 báo giá trong **Báo giá đã lưu**, bấm **Gộp thành báo giá mới**. Mặc định nối nguyên các trang theo thứ tự nguồn. Không gom sản phẩm hoặc phân trang lại. Mọi trang bìa, ngân sách, sản phẩm và cảm ơn đều được giữ, kể cả bìa/lời kết xuất hiện nhiều lần. Chỉ số trang ở chân trang được đánh lại liên tục.

Mỗi nguồn lưu một snapshot đã kiểm tra và danh sách cấu trúc trang gốc, gồm loại trang, nhóm giá, thương hiệu, danh mục, bố cục và ID sản phẩm theo đúng vị trí. Mỗi trang gộp tham chiếu snapshot nguồn; renderer dùng thông tin riêng của nguồn: giá/chiết khấu/phí/giá ghi đè/số lượng/bộ 10, ảnh, ghi chú, chữ sửa theo trang, thiết lập 4/6/8 SP, hiện/ẩn giá, khách hàng, mã/ngày báo giá và thông tin tư vấn. Không dùng thiết lập chung để vẽ lại nội dung của nguồn khác.

Sắp xếp tự động chỉ đổi vị trí nguyên trang sản phẩm trong các ô trang sản phẩm, giữ vị trí các trang bìa/ngân sách/cảm ơn theo nguồn. Kéo chuột/cảm ứng hoặc dùng ↑ ↓/Home/End cho phép di chuyển bất kỳ nguyên trang nào. Preview/PDF/PowerPoint dùng cùng danh sách trang. Màn hình bản gộp không có điều khiển sửa sản phẩm, giá, chữ hay bố cục; muốn sửa, mở nguồn rồi gộp lại.

Bản gộp là báo giá mới, người dùng bấm **Lưu báo giá chung** sau khi kiểm tra. Khách hàng lưu bản gộp được chọn lại nhưng không thay chữ/khách hàng hiển thị trên các trang nguồn. Các báo giá nguồn không bị sửa/xóa. Gộp tiếp một bản đã gộp sẽ làm phẳng các tham chiếu về snapshot gốc, giữ đúng thứ tự trang đang hiển thị, không lồng dữ liệu vô hạn.

Giới hạn 1.000 sản phẩm, 100 snapshot và 1.500 trang; kiểm tra kích thước JSON trước khi áp dụng để không vượt giới hạn lưu 2 MB hiện có. Nguồn đọc lỗi, dữ liệu không hợp lệ hoặc payload quá lớn không thay tài liệu đang mở. Đổi tài khoản/rời màn hình chặn kết quả tải về muộn. Không có migration và không thay công thức giá/thuế.

**Bản gộp cũ:** phiên bản PR710 đã phân trang lại và không lưu liên kết trang gốc, nên không đủ dữ liệu để tự phục hồi vị trí nguồn. Giao diện cảnh báo người dùng chọn lại báo giá nguồn để gộp nguyên trang; không tự sửa dữ liệu đã lưu.

## Kiểm tra

```sh
npm run typecheck
npm run ui:build
node --import tsx tests/app/catalogue-merge.test.ts
node --import tsx tests/app/catalogue-reorder.test.ts
node --import tsx tests/app/catalogue-quotes.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/catalogue-merge.mjs
```

Browser test: API/router thật, PGlite và cổng xác thực Catalogue với dữ liệu giả. PC 1440/mobile 390, hai nguồn 8/6 SP/trang có ảnh và thiết lập hiện giá/nội dung bìa/ghi chú/thông tin tư vấn khác nhau. So sánh từng pixel của cả 8 trang trước/sau khi gộp và sau lưu/mở lại: chỉ bỏ qua hình chữ nhật chứa số trang; mọi pixel còn lại phải trùng. Kiểm tra chọn qua lọc, hủy form, lỗi nguồn thứ hai, sort nguyên trang, kéo chuột/cảm ứng, phím End, không có nút chỉnh nội dung, nguồn vẫn revision 1, không lỗi JavaScript/tràn ngang. Xuất PDF 8 trang và PowerPoint 8 slide. Ảnh/file ở `/workspace/artifacts/catalogue-preserve-pages`.

Unit test kiểm tra cấu trúc từng trang và thứ tự sản phẩm, metadata/giá bộ của từng nguồn, snapshot độc lập với thiết lập bản gộp, gộp tiếp bản đã gộp, lưu/mở lại, từ chối chỉ mục trang sai/ID sản phẩm lạ/nguồn lồng vô hạn ở cả client và server. Bộ test cũ có bài PostgreSQL concurrency được skip khi thiếu `TEST_PG_URL`; PGlite không phải benchmark production. Chưa xác minh trên CRM production trước khi merge/deploy PR sửa.
