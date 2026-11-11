# Hình đào tạo quy trình Nhân viên & Kho

`scripts/testing/warehouse-training-guide.mjs` chụp 37 màn hình từ UI/router thật trên dữ liệu fixture cô lập. Chặn request ngoài localhost, không đọc credential hoặc dữ liệu khách hàng production. Các trạng thái nguồn phục vụ ảnh có thể được dựng sẵn bằng fixture; ảnh đào tạo không thay thế kiểm thử giao dịch nhập/xuất toàn tuyến.

```sh
REVIEW_DIR=/tmp/warehouse-guide/images node --import tsx scripts/testing/warehouse-training-guide.mjs
GUIDE_SOURCE_ONLY=1 REVIEW_DIR=/tmp/warehouse-guide/images node --import tsx scripts/testing/warehouse-training-guide.mjs
```

Playwright được lấy từ `PLAYWRIGHT_MODULE` nếu đặt; mặc định dùng module của runtime. Chromium `/usr/bin/chromium`. Bộ đầu 26 ảnh; bộ nguồn 11 ảnh. Tất cả tên, đơn hàng, sản phẩm, quỹ/định mức đều là minh họa. Khi chụp chỉ ẩn toast tạm thời và nút chat nổi để tránh che nhãn/nút, không sửa nội dung nghiệp vụ. Hai file `capture-results*.json` lưu URL hash, ảnh và lỗi JS.

Bộ đầu còn kiểm chứng bằng giao diện: nhận việc đơn → báo vướng → tiếp tục → duyệt khoảng chờ → gửi kết quả → Manager yêu cầu làm lại sau khi nguồn hoàn tất → nút Nhận việc vẫn xuất hiện → làm lại → xác nhận. Bộ này phát hiện và bảo vệ lỗi UI ẩn nút làm lại dù API đã cho phép. Định mức và thời gian bắt đầu cũ được giữ bởi backend; giao diện không tạo việc thay thế.

Tài liệu xuất cho người dùng gồm HTML có ảnh nhúng và PDF. Phần nghiệp vụ có sẵn (đóng gói, NCC, điều chuyển, kiểm kê) được tách khỏi phần phân công Kho mới; không khẳng định tính năng mới đã deploy production chỉ vì ảnh chụp thành công. Tài liệu không tự thay quyền kho hoặc tự chạy migration/cron.
