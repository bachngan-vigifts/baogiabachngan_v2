-- Dọn bảng Action Scheduler của web Lock (WooCommerce). Anh Thái tự chạy trong phpMyAdmin, KHÔNG chạy tự động.
-- Nếu tiền tố bảng không phải wp_ thì đổi wp_ ở mọi dòng bên dưới.
-- BƯỚC 0: Xuất (Export) 2 bảng wp_actionscheduler_actions và wp_actionscheduler_logs làm bản sao lưu trước khi chạy.

-- BƯỚC 1: Xem trước (chỉ đọc). Gửi kết quả cho em xem trước khi xóa.
SELECT status, COUNT(*) AS so_dong, MIN(scheduled_date_gmt) AS cu_nhat
FROM wp_actionscheduler_actions GROUP BY status;

-- BƯỚC 2: Xóa nhật ký của các tác vụ đã xong/đã hủy quá 14 ngày (không đụng tác vụ đang chờ hoặc đang chạy).
DELETE l FROM wp_actionscheduler_logs l
JOIN wp_actionscheduler_actions a ON a.action_id = l.action_id
WHERE a.status IN ('complete', 'canceled')
  AND a.scheduled_date_gmt < (UTC_TIMESTAMP() - INTERVAL 14 DAY);

-- BƯỚC 3: Xóa chính các tác vụ đã xong/đã hủy quá 14 ngày.
DELETE FROM wp_actionscheduler_actions
WHERE status IN ('complete', 'canceled')
  AND scheduled_date_gmt < (UTC_TIMESTAMP() - INTERVAL 14 DAY);

-- BƯỚC 4: Giải phóng dung lượng.
OPTIMIZE TABLE wp_actionscheduler_actions, wp_actionscheduler_logs;
