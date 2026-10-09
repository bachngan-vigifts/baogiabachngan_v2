-- ĐỔI SỐ CÁC BÁO GIÁ BỊ TRÙNG SỐ (do lỗi cũ: mỗi nhân viên tự đếm trên báo giá của mình nên ai cũng ra _001).
-- Chạy trong Supabase → SQL Editor. Làm 2 bước:
--   BƯỚC 1 (chỉ xem): liệt kê số bị trùng. Báo giá TẠO SỚM NHẤT giữ nguyên số; các báo giá sau sẽ được đổi.
--   BƯỚC 2 (đổi số): chỉ chạy khi đã xem bước 1 và đồng ý. Lưu ý: số báo giá đã gửi cho khách (PDF / Excel) sẽ khác số mới.
-- Bước 2 cập nhật: số báo giá + nội dung báo giá (data.quoteNo) + ô tìm kiếm + số báo giá ghi trên đơn hàng tạo từ báo giá đó;
-- tăng phiên bản báo giá (ai đang mở báo giá đó sẽ được báo tải lại, không ghi đè).
-- Số gõ tay bị trùng (không theo mẫu HRC_/B2B_/VG_BG…) chỉ được liệt kê, không tự đổi – sửa tay trên web.

-- BƯỚC 1: xem trước
SELECT q.quote_no AS so_bao_gia, q.id, q.created_at, e.name AS nguoi_tao,
       CASE WHEN row_number() OVER (PARTITION BY q.quote_no ORDER BY q.created_at, q.id) = 1 THEN 'giữ nguyên' ELSE 'sẽ đổi số' END AS xu_ly,
       CASE WHEN q.quote_no ~ '^(HRC|B2B|VG)_BG[0-9]{8}_[0-9]{3,}$' THEN 'tự sinh' ELSE 'gõ tay – sửa tay' END AS loai_so
FROM staff_quotations q LEFT JOIN staff_members e ON e.id = q.creator_id
WHERE q.quote_no IN (SELECT quote_no FROM staff_quotations GROUP BY quote_no HAVING count(*) > 1)
ORDER BY q.quote_no, q.created_at;

-- BƯỚC 2: đổi số (bỏ dấu -- ở đầu các dòng bên dưới rồi chạy)
-- DO $$
-- DECLARE r record; head text; nxt int; newno text;
-- BEGIN
--   FOR r IN
--     SELECT id, quote_no FROM (
--       SELECT id, quote_no, created_at, row_number() OVER (PARTITION BY quote_no ORDER BY created_at, id) AS rn
--       FROM staff_quotations WHERE quote_no ~ '^(HRC|B2B|VG)_BG[0-9]{8}_[0-9]{3,}$') x
--     WHERE rn > 1 ORDER BY created_at, id
--   LOOP
--     head := substring(r.quote_no from '^((?:HRC|B2B|VG)_BG[0-9]{8}_)');
--     SELECT coalesce(max(substr(quote_no, length(head) + 1)::int), 0) + 1 INTO nxt
--       FROM staff_quotations WHERE left(quote_no, length(head)) = head AND substr(quote_no, length(head) + 1) ~ '^[0-9]+$';
--     newno := head || lpad(nxt::text, 3, '0');
--     UPDATE staff_quotations
--        SET quote_no = newno, data = jsonb_set(data::jsonb, '{quoteNo}', to_jsonb(newno))::text,
--            search_text = replace(search_text, lower(r.quote_no), lower(newno)), revision = revision + 1
--      WHERE id = r.id;
--     UPDATE sales_orders SET quote_no = newno WHERE quote_id = r.id;
--     RAISE NOTICE 'Báo giá % : % -> %', r.id, r.quote_no, newno;
--   END LOOP;
-- END $$;
