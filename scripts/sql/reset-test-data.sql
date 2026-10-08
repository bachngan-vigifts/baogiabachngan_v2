-- =====================================================================================================
-- XOÁ DỮ LIỆU CHẠY THỬ (chạy MỘT LẦN trên Supabase SQL Editor, KHÔNG phải migration).
--
-- XOÁ:  báo giá (+ dòng, lịch sử sửa, chia sẻ, theo dõi, thông báo duyệt) · đơn đặt hàng (+ dòng)
--       · HĐKT (+ bộ đếm số HĐKT) · lịch thu + khoản thu · chuyến giao hàng · phiếu đóng gói (+ ảnh)
--       · công việc (+ trao đổi) · khách hỏi tồn · nhật ký chăm sóc KH · thông báo chuông · tin nhắn chat.
-- GIỮ:  nhân viên, tài khoản, chức vụ, khách hàng (+ người liên hệ, phụ trách, chiết khấu, tài khoản trang khách),
--       sản phẩm, giá, tồn kho, NCC, nhập hàng, bảng lương / chấm công, đăng ký nhận thông báo đẩy, dữ liệu Sapo.
--
-- Cách chạy: dán toàn bộ file vào SQL Editor → Run. Tất cả nằm trong MỘT giao dịch: lỗi ở bất kỳ bước nào thì
-- không có gì bị xoá. Kết quả cuối là bảng đếm số dòng còn lại (phải toàn 0) của các bảng đã xoá.
-- File đính kèm chat nằm ở Storage (bucket baogiabachngan-v2-files, thư mục chat/) – SQL không xoá được;
-- vào Supabase → Storage → baogiabachngan-v2-files → chọn thư mục chat → Delete.
-- Kiểm tra tự động: tests/db/reset-test-data.test.ts.
-- =====================================================================================================
BEGIN;

-- Tin nhắn chat
DELETE FROM chat_attachments;
DELETE FROM chat_messages;
DELETE FROM chat_members;
DELETE FROM chat_conversations;

-- Thông báo chuông
DELETE FROM staff_web_notification_reads;
DELETE FROM staff_web_notifications;

-- Nhật ký chăm sóc khách hàng
DELETE FROM customer_activities;

-- Công việc
DELETE FROM task_comments;
DELETE FROM tasks;

-- Khách hỏi tồn
DELETE FROM customer_stock_requests;

-- Thu tiền, giao hàng, đóng gói, HĐKT, đơn hàng (con trước, cha sau)
DELETE FROM customer_payments;
DELETE FROM payment_schedules;
DELETE FROM delivery_lines;
DELETE FROM deliveries;
DELETE FROM packing_slip_photos;
DELETE FROM packing_slip_lines;
DELETE FROM packing_slips;
DELETE FROM sales_contracts;
DELETE FROM contract_counters;          -- số HĐKT đếm lại từ đầu
DELETE FROM sales_order_lines;
DELETE FROM sales_orders;

-- Báo giá
DELETE FROM staff_notification_reads;
DELETE FROM staff_quote_notifications;
DELETE FROM quote_shares;
DELETE FROM quote_revisions;
DELETE FROM quote_order_followups;
DELETE FROM quote_lines;
DELETE FROM staff_quotations;

COMMIT;

-- Kiểm tra: mọi bảng đã xoá phải còn 0 dòng.
SELECT t.name, t.n FROM (VALUES
  ('staff_quotations', (SELECT count(*) FROM staff_quotations)), ('sales_orders', (SELECT count(*) FROM sales_orders)),
  ('sales_contracts', (SELECT count(*) FROM sales_contracts)), ('customer_payments', (SELECT count(*) FROM customer_payments)),
  ('payment_schedules', (SELECT count(*) FROM payment_schedules)), ('deliveries', (SELECT count(*) FROM deliveries)),
  ('packing_slips', (SELECT count(*) FROM packing_slips)), ('tasks', (SELECT count(*) FROM tasks)),
  ('customer_stock_requests', (SELECT count(*) FROM customer_stock_requests)), ('customer_activities', (SELECT count(*) FROM customer_activities)),
  ('staff_web_notifications', (SELECT count(*) FROM staff_web_notifications)), ('chat_messages', (SELECT count(*) FROM chat_messages)),
  ('chat_conversations', (SELECT count(*) FROM chat_conversations))
) AS t(name, n);
