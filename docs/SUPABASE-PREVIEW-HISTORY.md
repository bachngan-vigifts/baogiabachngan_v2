# Sửa lịch sử dựng Supabase Preview của PR #589

## Nguyên nhân đã xác nhận

Check Supabase Preview tại commit `7956ba53` dừng với `relation "web_store_orders" does not exist` khi chạy `ALTER TABLE ... ADD COLUMN financial_snapshot`. CI mã nguồn 4/4 và cổng tổng đều đạt.

Đối chiếu chỉ đọc registry `supabase_migrations.schema_migrations`: production có bảng/column/index và RLS, nhưng lịch sử không có bước tạo `web_store_orders`. Danh sách CREATE TABLE trong repository so với registry còn thiếu `inventory_adjustments`. Các bước GHN/order-address đã chạy tay nhưng chưa có trong registry; cần đứng đúng thứ tự trước các bước dùng chúng. Đây là vấn đề dựng lại môi trường, không phải lỗi migration mới của tính năng tải SePay (tính năng không thêm schema).

## File sửa chạy tay

Theo quy ước dự án, không tự chạy migration/đổi metadata production trong phiên sửa code. Chủ dự án cần:

1. Mở SQL Editor của project cha `taceqfnsorewelsbdckg`.
2. Đọc rồi chạy `scripts/sql/repair-preview-missing-history.sql`.
3. Chạy `scripts/sql/assert-preview-history-baseline.sql`, kết quả cần là `preview_history_baseline_ok`.
4. Dựng lại/reset **chỉ Preview của PR #589**, không reset project cha. Preview lỗi hiện tại: `dkwdlqajthwvsixflbei`, nhánh `feat/sepay-read-transactions`; đây là nhánh thử không sao chép dữ liệu production. Việc thêm registry ở project cha không tự bổ sung bảng cho Preview cũ đã lỗi, nên cần chạy lại toàn bộ lịch sử.
5. Xem lại Supabase Preview. Nếu gặp phụ thuộc lịch sử khác, giữ nguyên lỗi để xử lý tiếp; không tắt check hay đánh dấu thành công thủ công. Chưa xác nhận dựng lại toàn bộ lịch sử trên Supabase cho tới bước này.

File repair **chỉ ghi bốn hàng metadata** vào `supabase_migrations.schema_migrations`, không thực thi DDL ứng dụng chứa trong payload, không tạo/sửa/xoá bảng ứng dụng, đơn, phiếu thu hoặc tồn kho. Các SQL được lưu nguyên văn từ:

- `migrations/postgres/20261019035500_web_store_orders.sql`
- `migrations/postgres/20261019043000_web_store_order_ghn.sql`
- `migrations/postgres/20261022204500_web_order_ghn_address.sql`
- `migrations/postgres/20261026042035_inventory_adjustment_approval.sql`

Không đưa file repair vào thư mục migration hoặc workflow deploy. Nó kiểm tra schema/cột/index và RLS đã có trước khi ghi; nếu thiếu thì rollback. Cùng version nhưng khác tên/SQL cũng rollback, không ghi đè lịch sử. Chạy lại cùng file không thêm hàng trùng. Chỉ số lượng/cấu trúc được đọc khi chẩn đoán, không đọc giao dịch tài chính.

## Kiểm chứng

`tests/db/preview-history-repair.test.ts` chạy trên CSDL cô lập: so sánh metadata schema và hàng sentinel trước/sau, chạy lại không trùng, từ chối schema thiếu/lịch sử xung đột. Tái hiện lỗi ALTER thiếu bảng rồi replay CREATE → GHN → financial snapshot → địa chỉ → stock → CRM edit theo thứ tự thành công. Test bảo đảm SQL lưu trùng nguyên văn các file nguồn. Đây là kiểm thử các phụ thuộc đã tìm thấy, không thay thế việc dựng lại Preview thật.

Tham khảo chính thức: [Supabase Branching Troubleshooting](https://supabase.com/docs/guides/deployment/branching/troubleshooting).
