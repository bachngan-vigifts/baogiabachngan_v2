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

## Khắc phục lỗi KH mới khi chỉ bật thưởng HĐKT

Nút áp dụng cũ dùng chung `salesAutomationApply` cho cả KPI và thưởng, nên thưởng Sale Admin bị chặn bởi trần KH mới 10% dù người đó không tính KPI. Nay thưởng dùng `contractBonusFrom` / `contractBonusApply`; KPI giữ hai tham số riêng. Màn hình Cài đặt thưởng HĐKT không đọc/sửa tháng hoặc công tắc KPI. Các tham số nằm trong JSON cấu hình hiện có, không migration.

Chính sách cũ thiếu hai khoá mới kế thừa đúng tháng/công tắc cũ, không tự ngừng thưởng đang áp dụng. Phiếu đã chốt vẫn dùng bản chụp. Bản chụp mới lưu riêng `salesCrm.bonusApply` và `salesCrm.kpiApply`: chốt chỉ ghi sổ thưởng nếu phần thưởng đã áp dụng; chỉ khoá nguồn giao dịch nếu đã chốt KPI tự động. Bản chụp cũ giữ cách đọc tương thích.

24 test tính lương/ghi sổ/kiến trúc giao diện đạt; 4 test hồi quy riêng được chạy lại sau khi bổ sung trường hợp chốt cả bảng chỉ áp dụng KPI. Kiểm tra typecheck đã hoàn tất thành công. Browser thật 1280/390 px xác nhận giữ nguyên KH mới 20%, tháng KPI 0 và công tắc KPI tắt, vẫn lưu thưởng HĐKT thành công, tính 50.000 sao + 10.000 thanh lý và KPI Sale Admin null. Chế độ đối chiếu chưa cộng tiền; nhân viên không có quyền sửa lương. Ảnh `policy-*.png` và JSON là dữ liệu giả lập. Không sửa dữ liệu production.
