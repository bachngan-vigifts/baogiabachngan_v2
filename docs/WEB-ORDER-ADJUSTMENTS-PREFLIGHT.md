# Đồng bộ đầy đủ tiền đơn website

## Hiện trạng đã kiểm tra

Webhook WooCommerce hiện giữ total và line_items (sku/name/quantity/total), bỏ coupon_lines, fee_lines, shipping_lines, discount_total, thuế và metadata đổi điểm. Bảng web_store_orders không có cột lưu các khoản này. ghnFee là phí hãng vận chuyển, không phải phí ship thu khách. POS và việc xuất hoá đơn web hiện chỉ có tổng đơn, chưa có bảng đối chiếu các khoản giảm/phí.

## Thay đổi schema đã được duyệt tạo migration

Thêm đúng 1 cột vào bảng hiện có:

- `web_store_orders.financial_snapshot`: `text NOT NULL DEFAULT '{}'`, lưu JSON có phiên bản: tiền hàng trước/sau giảm, coupon (mã và tiền giảm), phí phát sinh có dấu (kể cả phí âm đổi điểm), phí ship thu khách/tên phương thức, thuế, điểm đổi nếu nguồn cung cấp, tổng tiền gốc từ website.
- Không thêm bảng, index, quyền, cron; RLS và quyền bảng giữ nguyên. Không đổi cột total/ghnFee hoặc sổ thu chi/công nợ.
- Người dùng đã duyệt phương án và tạo migration. File: `migrations/postgres/20261021035601_web_order_financial_snapshot.sql` (tạo tên bằng Supabase CLI 2.81.0). Người dùng đã duyệt riêng bước DB live. Đã áp dụng SQL lên CRM `taceqfnsorewelsbdckg` ngày 21/10/2026 qua Supabase MCP; lịch sử DB ghi name `web_order_financial_snapshot`, version `20261021041220`. Đã xác minh kiểu text, NOT NULL, mặc định `{}`, không có snapshot NULL; RLS giữ bật và không thêm policy/quyền.
- Dòng cũ mặc định `{}` = chưa có chi tiết, không tự coi coupon/đổi điểm/ship là 0. Dữ liệu chi tiết chỉ được bổ sung khi website gửi lại đơn, không suy ngược từ tổng.

## Tiếp nhận và hiển thị

Giữ tổng thanh toán WooCommerce làm số chuẩn, không tự cộng/trừ lại khiến trùng giảm giá. Phân biệt subtotal/total và tax. Coupon và phí âm đổi điểm được lưu riêng theo đúng cấu trúc nguồn; metadata điểm chỉ là thông tin tham chiếu, không tự trừ thêm lần nữa. Không suy đoán số điểm từ số tiền hoặc ngược lại.

Webhook lặp cập nhật cùng source/externalId; cập nhật chỉ trạng thái không làm mất chi tiết tài chính đã có. Nút làm mới/xác nhận/huỷ qua cầu nối giữ snapshot, không thay đổi tiền nếu nguồn không gửi chi tiết mới. Lock và Minh Long dùng chung quy tắc nhưng vẫn kiểm đúng quầy.

Hiện đầy đủ tại chi tiết đơn web ở POS, việc xuất hoá đơn web và khung chi tiết Công việc Kế toán theo quyền hiện có. Không đưa dữ liệu tên coupon/phí từ nguồn vào innerHTML.

## Hợp đồng dữ liệu nguồn

Website/cầu nối gửi WooCommerce order chuẩn: line_items (subtotal/subtotal_tax/total/total_tax), coupon_lines (code/discount/discount_tax), fee_lines (name/total/total_tax), shipping_lines (method_title/method_id/total/total_tax), discount_total/discount_tax/shipping_total/shipping_tax/total_tax/total/currency. Đổi điểm qua coupon hoặc fee âm được giữ nguyên. Nếu plugin có số điểm riêng thì gửi points_redemption {points, amount} hoặc metadata điểm đã chuẩn hoá; không dùng số điểm sẽ tích luỹ như điểm đã đổi.

Repo hiện không chứa mã WordPress/n8n đẩy đơn. Cần xác minh payload thực tế trước khi khẳng định web đã gửi đủ; CRM không thể khôi phục trường nguồn chưa gửi. Không tạo đơn/thu tiền thật để test.

## Kiểm thử đã thực hiện

Mẫu 38.545.020 − coupon 150.000 − đổi điểm 5.000 + ship 0 = 38.390.020, giữ total nguồn. Có ship >0 và miễn phí; thuế coupon/phí/ship; coupon đổi điểm không trừ hai lần; nguồn thiếu dữ liệu/đơn cũ; webhook lặp/đổi coupon/đổi điểm về 0; chỉ cập nhật trạng thái; phân quyền Lock/ML/kế toán; UI thoát HTML; typecheck/build và các test liên quan. Chưa test live/máy in.

Kết quả: 67 trường hợp liên quan đã xác minh đạt (bộ hồi quy 56, miền tính tiền 4, UI mới 3, nâng cấp dữ liệu cũ 1, schema migration 3); fixture VM của 3 test Kế toán đã cập nhật để nạp dependency UI thật và chạy lại đạt. Typecheck/build đạt. Chromium mô phỏng 1200px/390px đạt. Không chạy toàn bộ suite, chưa test luồng thật từ WordPress/máy in, migration live đã được áp dụng theo phê duyệt riêng. Truy vấn metadata sau migration xác nhận cột đúng kiểu/default, RLS vẫn bật; anon/authenticated không có policy cho phép đọc dòng và không có quyền bypass RLS.
