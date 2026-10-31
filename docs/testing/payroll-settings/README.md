# Cài đặt lương và thưởng Sale / Sale Admin

Vấn đề: lối sửa hồ sơ lương nằm sâu trong hồ sơ nhân viên; chi tiết thưởng chỉ xuất hiện khi có `salesCrm`, còn dòng thu nhập bằng 0 bị lọc khỏi phiếu cá nhân. Cơ chế menu thao tác trên điện thoại còn có thể gom nút cài đặt thưởng vào menu phụ. Khi chính sách CRM mặc định tắt, người dùng không thấy cách bật hoặc lý do chưa có thưởng.

Thay đổi: thêm nút Cài đặt lương nhân viên và Cài đặt thưởng HĐKT luôn hiện trên Bảng lương; tab Cài đặt lương liệt kê toàn bộ người đang có trên bảng, kể cả chưa có hồ sơ. Hồ sơ cá nhân có nút Cài đặt lương ở đầu trang. Nút mở đúng form và API hiện có; không mở quyền mới.

Mục Thưởng Sale / Sale Admin luôn hiện trên Tổng hợp và Sale & VP: bảng mức sao, thanh lý và trạng thái tắt / chưa đến tháng / đối chiếu / áp dụng. Màn hình cài thưởng riêng dùng ô chọn tháng, chọn chế độ và các tham số thưởng; lưu giữ toàn bộ tham số lương khác. Phiếu cá nhân không ẩn dòng thưởng bằng 0 và giải thích khi chưa có dữ liệu CRM. Sale Admin không xuất hiện trường KPI trong form và chi tiết thưởng.

Không tự bật chính sách thực tế, đổi mức lương hay quyền hưởng thưởng trên production. Không đổi công thức, nghiệp vụ chốt/trả, bản chụp đã chốt, API hoặc schema. Không migration.

Kiểm chứng: typecheck, kiểm tra cú pháp JS và 19 test bảng lương / Sale Admin / sổ thưởng / cấu trúc giao diện đạt. Browser Chromium thực + router/PGlite, chỉ dữ liệu giả lập, chặn kết nối ngoài máy thử:

- 1280 và 390 px: đi từ Bảng lương → Cài đặt lương → đúng người → form; lưu lương cơ bản và quyền hưởng thưởng qua API thật.
- Sale Admin không có ô KPI; cấu hình tháng và chế độ đối chiếu không cộng vào thực nhận. Chuyển sang áp dụng hiển thị 50.000 thưởng 2 sao + 10.000 thanh lý = 60.000, KPI null.
- Tham số KPI doanh số khác đã đặt riêng vẫn giữ nguyên khi chỉ sửa cấu hình thưởng.
- Nhân viên xem hồ sơ mình không có nút sửa lương và API tham số trả 403. Không lỗi JavaScript, không tràn ngang trang.
- Ảnh/JSON kèm theo là dữ liệu giả lập. Chạy lại: `PLAYWRIGHT_MODULE=<đường dẫn playwright/index.mjs> node --import tsx scripts/testing/payroll-settings.mjs`.
