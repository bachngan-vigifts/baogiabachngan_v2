# NCC: giao diện, đơn theo mã và phiếu kiểm tồn

Bản sửa ngày 12/11/2026, tiếp theo PR #638. Chưa merge/deploy hoặc chạy migration production.

## Hành vi mới

- Dùng lại font Be Vietnam Pro có sẵn trong CRM; chữ nội dung 13–14 px, tiêu đề 28 px, input mobile 16 px. Sidebar xanh đậm, xanh lá cho thao tác, xanh dương cho liên kết, vàng cho trạng thái chờ. SVG nội bộ, không thêm thư viện hoặc request icon ngoài.
- Tổng quan thêm ưu tiên xử lý và lịch hẹn trên các đơn gần đây. Thẻ công nợ được thay bằng số mã và số lượng còn giao; không suy đoán lịch giao tương lai từ đơn chưa có ngày.
- Sản phẩm có **SL hàng đặt**, số còn giao và nút mở danh sách đơn/ngày hẹn. Số đặt cộng dòng của đơn mua đã duyệt, chưa hủy, đúng NCC; số đã nhận chỉ cộng goodQty của phiếu nhận có hiệu lực. Còn giao tính theo từng dòng, chặn dưới 0. Dùng cách làm tròn số lượng hiện hành của đơn mua. Không cộng khoản hỏng hoặc phiếu nhận đã hủy.
- Danh sách đơn theo mã tải khi bấm, 16 dòng/trang. Giữ riêng từng đơn, ngày hẹn dòng ưu tiên hơn ngày hẹn toàn đơn; thiếu cả hai hiển thị “Chưa có”. Bấm số đơn mở chi tiết đơn mua. Số lượng không bị nhân lên theo số phiếu nhận.
- **Kiểm tồn theo phiếu yêu cầu NCC kiểm từng mã**: Manager chọn NCC, tạo số phiếu/ngày cần hàng và 1–100 mã từ đơn mua được chia sẻ. NCC phản hồi từng mã: số đáp ứng, ngày có thể giao (bắt buộc khi có hàng), ghi chú. Ghi đè phản hồi cần đúng revision của phiếu; phiếu nhiều mã chỉ ghi hoàn tất khi đủ phản hồi. Trang vẫn có số lượng hàng đặt/còn giao và mở danh sách đơn theo mã.
- Kết quả kiểm tồn không tự nhập kho, công bố tồn, sửa ngày hẹn trên đơn, tạo phiếu nhận hoặc ghi tiền. Không lấy bảng tồn đã công bố cũ làm phiếu kiểm. Không backfill phiếu giả.
- **Tạm ứng/Công nợ tạm ngưng trên giao diện mới**: trang thông báo chưa mở, không gọi API danh sách/chi tiết/export, không có nút gửi đề nghị. Giữ API cũ cho khách đang dùng phiên bản trước; không sửa nghiệp vụ tiền của CRM.

Luồng Kiểm tồn được triển khai theo hướng phiếu yêu cầu NCC kiểm khả năng đáp ứng. Nếu nghiệp vụ cần phiếu NCC tự kiểm đếm kho thì cần chốt lại trước khi đưa lên thật; hai loại phiếu không được dùng thay nhau.

## Nguồn và quyền

- API drill-down: `GET /supplier-portal/workspace/products/:sku/orders?limit=16&offset=0`.
- Danh sách/chi tiết/export phiếu dùng endpoint `workspace/stock` hiện có; nguồn đổi sang `supplier_stock_checks` và `supplier_stock_check_lines`.
- Manager tạo: `POST /supplier-workspace-admin/stock-checks?supplierId=...`; clientKey + hash và unique số phiếu trong NCC chặn gửi lặp/đổi nội dung cùng khóa.
- NCC phản hồi: `POST /supplier-portal/workspace/stock/:lineId/respond`. Backend lấy supplierId từ tài khoản, kiểm chủ phiếu và revision dưới khóa hàng. Manager không phản hồi thay NCC. Không trả nguồn khách/note nội bộ/giá vốn/lương.
- SQL dùng tham số. Gom số nhận và số đặt trước khi join; phân trang server, không tải toàn bộ danh sách đơn xuống browser.
- Chuyển trang hủy GET đang chạy; response trễ không được ghi lên trang tạm ngưng hoặc drawer đã đóng. Các thao tác ghi không tự retry.

## Migration và triển khai

**Chỉ chuẩn bị, chưa chạy production:** `migrations/postgres/20261112104633_supplier_stock_checks.sql` (tạo bằng Supabase CLI). Thêm 2 bảng/4 index; không sửa migration cũ hoặc dữ liệu đang có. RLS bật, thu hồi PUBLIC/anon/authenticated, không policy mở Data API.

`assert-supplier-stock-checks.sql` chỉ đọc: kiểm bảng/cột/index, RLS, quyền, policy, constraint phản hồi. Đã nối vào deploy API và danh mục migration tháng 11. Phải duyệt SQL rồi chạy migration và assert trước khi merge, nếu không workflow API sẽ dừng để bảo vệ release.

Thứ tự: duyệt giao diện/nghiệp vụ phiếu → duyệt SQL → chạy migration + assert READ ONLY → CI đúng HEAD xanh → merge → API → UI → kiểm tra production. Rollback UI/API về release trước, giữ bảng/phiếu đã có; không DROP.

## Kiểm tra

- Typecheck, UI build, kiểm tra architecture và mọi migration tháng 11 có gate.
- API/PGlite: tổng theo SKU và phân trang; ngày theo dòng/fallback; đơn hủy/chưa duyệt; nhiều phiếu nhận; nhận hỏng/phiếu hủy; phạm vi 2 NCC; SKU giả/SQL injection; trả số lượng JSON thật.
- Phiếu kiểm: Manager/NCC/Kế toán; mã ngoài phạm vi; mã trùng; số lượng/ngày sai; clientKey replay/nội dung khác; số phiếu trùng; revision cũ; nhiều mã phản hồi độc lập; không thay tiền, phiếu nhận, tồn hoặc ngày hẹn đơn gốc.
- Migration chạy lặp, assert READ ONLY; thử thiếu index, mở quyền PUBLIC và tắt RLS để bảo đảm gate phát hiện, không tự sửa.
- Browser đi qua router/PGlite: 10 trang ở 1440/390 px, mở đơn từ SL hàng đặt, popup mobile, tạo/đáp phiếu, chuyển nhanh khi API đang chậm; không lỗi JS, không tràn ngang trang, không request tới API Tạm ứng/Công nợ.
- 30 tình huống lỗi đăng nhập/phiên/mất mạng/gửi lặp của luồng cũ được chạy lại. Mọi dữ liệu/chứng từ trong kiểm thử là dữ liệu giả; chưa kiểm chứng hiệu năng bằng dữ liệu production.

Ảnh kiểm tra: `/workspace/output/supplier-workspace-refresh/`. Log: `/tmp/ncc-refresh-*.log`. Có thể chạy lại bằng `scripts/testing/supplier-workspace-live.mjs`; PLAYWRIGHT_MODULE trỏ tới Playwright nếu không cài trong repo.
