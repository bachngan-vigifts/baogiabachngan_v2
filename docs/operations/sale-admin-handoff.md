# Giao hồ sơ cho Sale Admin

Sau khi tạo thành công Đơn hàng hoặc HĐKT từ báo giá, CRM mở bảng chọn Sale Admin hoặc “Không giao”. Có thể mở lại bằng “Sale Admin xử lý” trên hồ sơ. Thao tác giao là request riêng; lỗi đọc/lưu giao việc không tạo lại chứng từ. Khi mất phản hồi lưu, bảng giữ nguyên lựa chọn và phiên bản để kiểm tra lại an toàn.

Người nhận phải là Sale Admin đang hoạt động, có quyền trang Báo giá, Đơn hàng, HĐKT. Manager hoặc người tạo/phụ trách hồ sơ được giao/bỏ giao. Ghi nhận vào audit journal; phiên bản riêng và khoá dòng báo giá chặn hai lựa chọn đồng thời ghi đè nhau.

Người nhận được sửa báo giá và chứng từ liên kết còn nháp. Sửa báo giá đã duyệt đưa báo giá về nháp để duyệt lại; chốt liên kết đơn đã duyệt, ký, kho và tiền giữ nguyên. Giao hồ sơ không cấp thêm quyền duyệt, huỷ, xoá hay thu/chi, không thay người bán/creator/assignee doanh thu. Bỏ giao hoặc đổi chức vụ loại quyền được cấp bởi việc giao; quyền vốn có do sở hữu/chia sẻ/phòng ban vẫn áp dụng.

## Triển khai

1. CI mã nguồn đạt; chạy migration `migrations/postgres/20261121102152_sale_admin_handoff.sql` trước khi merge/deploy API. Migration chỉ thêm hai cột, không cập nhật dữ liệu nghiệp vụ, không thay RLS. `lock_timeout=5s` để không chờ khoá lâu.
2. Chạy `scripts/sql/assert-sale-admin-handoff.sql`. Deploy API có guard này và sẽ dừng nếu thiếu schema.
3. Merge PR xanh; chờ deploy API rồi UI. Kiểm tra nguồn API và UI đã có endpoint/bảng giao việc. Kiểm tra form bằng phiên CRM được phép; không tự tạo đơn tài chính thật để smoke test.

## Rollback

Deploy lại phiên bản API/UI trước thay đổi, giữ nguyên hai cột additive và audit. Không xoá cột/assignment khi rollback: phiên bản cũ bỏ qua các cột, tránh mất dữ liệu giao việc. Nếu migration chờ khoá thất bại, không deploy; kiểm tra giao dịch đang giữ khoá rồi chạy lại trong thời điểm phù hợp.

## Kiểm thử

- API trên PostgreSQL: giao/bỏ giao, HĐKT, báo giá duyệt lại, người bán bất biến, retry, phiên bản cũ, hai thao tác đồng thời, người nhận sai role và caller không có quyền, thu hồi theo chức vụ, không mở quyền duyệt/huỷ.
- `scripts/testing/sale-admin-handoff.mjs`: Chromium 390px/1280px; chọn người nhận, Không giao, mất phản hồi và retry cùng body, đổi tài khoản, nút trong viewport.
- Hồi quy quote-edit-requests, sale-admin-scope, quotation access, November migration gates; TypeScript và build UI.
