# Cân bằng kho nhanh từ phiếu điều chuyển

Nút trong drawer chi tiết phiếu điều chuyển chỉ hiện khi server xác nhận người xem có cả `inventory.view` và `inventory.manage`. Nút mở `#/inventory?transfer=<id>`, không lập phiếu hay ghi kho ngay.

Trang cân bằng tải lại quyền, phạm vi kho và phiếu nguồn; điền mỗi SKU một lần, lý do có số phiếu điều chuyển. Chọn kho để trống, chỉ liệt kê kho đi/kho đến còn trong phạm vi sổ kho. Số tăng/giảm để trống, tuyệt đối không dùng số lượng chuyển làm số điều chỉnh. Người dùng có thể bỏ mã không cần hoặc bổ sung mã qua form có sẵn.

Gửi phiếu vẫn dùng API cân bằng hiện có: kiểm quyền/phạm vi ở server, `clientKey` chống gửi lại, nhân viên gửi chờ Manager duyệt; Manager ghi trực tiếp. Phiếu điều chuyển và số lượng chuyển không đổi. Không tự sửa tồn thiếu cho đủ chuyển. Không migration, không truy vấn hoặc ghi production, không thay tích hợp Sapo/GHN.

Mobile giữ chính sách chỉ xem kho đang có; nút mới chỉ thao tác trên máy tính, tránh mở form rồi không có nút ghi trên điện thoại.

## Kiểm chứng

- UI tests: điền SKU duy nhất, số và kho để trống; chọn kho rõ ràng; chặn kho ngoài phiếu; không ghi khi mở/hủy; lý do có số phiếu; tải nền không mất số đang nhập; không mở form sau khi đã chuyển trang; chặn thiếu quyền/kho hoặc phiếu không còn truy cập được.
- API test: server bật/tắt action theo quyền; gọi đọc không ghi kho; giả gửi thẳng API khi mất quyền bị 403.
- Bộ test duyệt cân bằng kho và quyền đối ứng điều chuyển đã đạt, giữ giao dịch ghi kho/chờ duyệt/chống trùng hiện có.
- Typecheck, kiểm kiến trúc và trial UI.
- `scripts/testing/transfer-quick-adjustment.mjs`: CRM thật nối router/PGlite bằng dữ liệu giả, chặn mọi kết nối ra ngoài. 1280px: mở từ drawer, SKU sẵn, kho/số trống, ghi tăng 2 đúng một lần và phiếu chuyển vẫn pending với số lượng 24. 390px: không hiện nút ghi kho theo chính sách mobile hiện tại. Không lỗi JS.

Ảnh và `results.json` là dữ liệu thử local, không phải ảnh/dữ liệu production. Chưa kiểm trên Safari/iPhone thật.
