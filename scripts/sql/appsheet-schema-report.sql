-- DANH SÁCH BẢNG + CỘT CỦA APP APPSHEET (bản sao vigifts_appsheet_*) – KHÔNG lấy dữ liệu khách / đơn thật.
-- Chạy trong Supabase → SQL Editor (chỉ đọc). Kết quả gửi chủ dự án duyệt để lập bảng ánh xạ AppSheet → CRM mới (docs/THAY-APPSHEET.md, mốc M5).
-- Nếu cả 3 truy vấn đều trống: bản sao AppSheet CHƯA được nạp → cần xuất cấu trúc từ AppSheet (Data → Tables / Columns) hoặc
-- tiêu đề cột các sheet Google nguồn (chỉ dòng tiêu đề), không cần dữ liệu.

-- 1) Các app đã nạp
SELECT id, title, source_app_id, source_version, exported_at, imported_at
FROM vigifts_appsheet_apps ORDER BY imported_at DESC;

-- 2) Bảng + số cột + số dòng (chỉ ĐẾM, không đọc nội dung dòng)
SELECT t.app_id, t.table_name, t.schema_name, t.update_mode,
       (SELECT count(*) FROM vigifts_appsheet_fields f WHERE f.app_id = t.app_id AND f.table_name = t.table_name) AS so_cot,
       (SELECT count(*) FROM vigifts_appsheet_rows r WHERE r.app_id = t.app_id AND r.table_name = t.table_name) AS so_dong
FROM vigifts_appsheet_tables t ORDER BY t.app_id, t.table_name;

-- 3) Cột của từng bảng (tên, kiểu, khoá, bắt buộc, cột ảo) – cấu trúc, không có dữ liệu
SELECT f.table_name, f.ordinal, f.field_name, f.field_type, f.is_key, f.is_label, f.is_required, f.is_hidden, f.is_virtual
FROM vigifts_appsheet_fields f ORDER BY f.table_name, f.ordinal, f.field_name;
