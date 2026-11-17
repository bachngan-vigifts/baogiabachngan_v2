# Gộp báo giá Catalogue

Trong **Báo giá đã lưu**, tick **Chọn để gộp** trên 2–20 báo giá, rồi bấm **Gộp thành báo giá mới**. Lựa chọn giữ qua bộ lọc và phân trang. Tối đa 1.000 dòng sản phẩm theo giới hạn báo giá hiện hành; vượt giới hạn hoặc đọc lỗi bất kỳ nguồn nào thì chưa thay tài liệu đang mở.

Nhập tên và chọn thứ tự trang: ngân sách tự động, thương hiệu/danh mục, danh mục/thương hiệu, tên sản phẩm, giá tăng hoặc giảm. Bản gộp mở trong trình soạn thảo và chỉ lưu lên máy chủ khi bấm **Lưu báo giá chung**. Khách hàng/nhóm khách được chọn lại lúc lưu để tránh gán nhầm khách từ báo giá thành phần.

Giữ riêng từng dòng, kể cả SKU trùng nhưng khác giá. Sao chép giá niêm yết, chiết khấu, phí, giá ghi đè, số lượng và phạm vi bộ 10; không đọc giá mới từ thư viện. Dùng bố cục/bìa/lời kết của nguồn được chọn đầu tiên, một bìa và một lời kết chung. Tự phân lại trang theo số SP/trang đã chọn và giữ cả trang có một SP. Không sửa/xóa hay tăng phiên bản nguồn. Không thay công thức giá/thuế, không có migration.

Mục **Thứ tự trang báo giá gộp** hỗ trợ kéo chuột/cảm ứng và phím ↑ ↓, Home/End. Bìa đứng đầu, lời kết đứng cuối. Preview/PDF/PowerPoint cùng gọi `makeSlides`; số trang chạy liên tục. Thứ tự thủ công được lưu theo khóa nội dung trang. Nếu đổi sản phẩm/bố cục khiến khóa trang thay đổi, các trang mới được thêm sau những trang còn khớp, không ẩn sản phẩm; có thể chọn lại thứ tự tự động. Chữ tùy chỉnh của trang nguồn chỉ áp dụng khi nhóm sản phẩm và bố cục trang vẫn khớp sau khi phân lại.

Đọc các nguồn tuần tự qua API báo giá hiện có và quyền CRM hiện hành. Không gọi nhà cung cấp bên ngoài. Đổi tài khoản hoặc rời màn hình trong khi đọc sẽ ngăn kết quả cũ thay tài liệu hiện tại. Nút gộp chặn gửi lặp; không tự POST báo giá trong bước tạo bản gộp.

## Kiểm tra

```sh
npm run typecheck
npm run ui:build
node --import tsx tests/app/catalogue-merge.test.ts
node --import tsx tests/app/catalogue-reorder.test.ts
node --import tsx tests/app/catalogue-quotes.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/catalogue-merge.mjs
```

Browser test dùng API/router thật với PGlite và dữ liệu giả, cổng xác thực Catalogue thật. PC 1440px và mobile 390px: chọn qua lọc, hủy form, nguồn thứ hai lỗi mạng không làm dở bản gộp, trùng SKU/giữ giá, đủ tám sản phẩm trên năm trang, sort giá, kéo chuột/cảm ứng, phím End, lưu thành báo giá mới, reload giữ thứ tự. Xuất PDF năm trang và PowerPoint, kiểm tra nguồn vẫn revision 1, không có lỗi JavaScript hoặc tràn ngang. Ảnh và file xuất ở `/workspace/artifacts/catalogue-merge`.

Các test liên quan về A4/layout, creator, khoảng giá, hiển thị giá, preview selection, bảo mật và xác thực cũng được chạy. Bài PostgreSQL concurrency trong bộ test cũ bị skip khi không có `TEST_PG_URL`; PGlite không chứng minh tải hoặc cạnh tranh trên production. Chưa xác minh tính năng trong phiên đăng nhập production khi chưa merge/deploy PR.
