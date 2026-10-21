# Kiểm tra trước khi duyệt bán hàng

Không đổi schema, công thức giá hoặc công nợ. Không cron, không ghi DB live khi kiểm thử.

## Báo giá

Nút Duyệt hiện yêu cầu cập nhật giá mua. Manager xem popup CK mua vào theo từng mã; giữ nguyên CK % và giá nhập tay đã có. Hoàng Cung / Đài Các mặc định gợi ý 27%; chỉ điền mặc định cho dòng còn trống. Muốn đổi dòng đã có thì nhập trực tiếp hoặc chọn Dùng gợi ý, sau đó Áp dụng & lưu báo giá. Dòng chưa xác định được CK phải nhập tay ngay trong popup. Huỷ popup không ghi dữ liệu. Người được chỉ định duyệt không được mở rộng quyền xem/sửa giá vốn; giao diện chỉ cho tiếp tục nếu giá mua đã có đủ và yêu cầu xác nhận đã kiểm tra. API duyệt báo giá hiện có giữ nguyên hợp đồng; popup là bước kiểm tra trên giao diện. Duyệt từ Sơ đồ quy trình mở báo giá để đi qua bước kiểm tra này.

## Đơn hàng / HĐKT

`GET /orders/:id/approval-preflight`: phải có quyền trang, quyền duyệt và thuộc phạm vi đơn được xem. Chỉ trả cờ thiếu phí, không trả giá vốn. Chi phí in/khắc lấy từ chi phí gia công, không lấy phí in bán cho khách. Thiếu chi phí in/khắc thì Manager nhập từng dòng trong popup, lưu qua API báo giá hiện có cùng revision và các hook cập nhật chứng từ. Giá 0 nhập rõ ràng được chấp nhận. Người được chỉ định duyệt cần nhờ Manager nhập phí nếu thiếu.

Thiếu CK khách hoặc thiếu vận chuyển: cảnh báo và xác nhận không phát sinh, hoặc quay lại sửa báo giá. Không ép nhập số tiền giả. Khách nhận trả cước là trường hợp hợp lệ. API duyệt kiểm lại phí in và yêu cầu `costWarningsReviewed: true` nếu còn các cảnh báo này. Không tự tăng phí hoặc thay đổi số tiền thu khách.

## Công nợ quá hạn

API tạo đơn/HĐKT và duyệt đơn/HĐKT chặn khi khách có khoản quá hạn: mã `CUSTOMER_DEBT_OVERDUE`. Không có cơ chế bỏ qua. Đối chiếu bằng customerId hoặc MST không rỗng; không ghép khách bằng tên hay điện thoại. Tái sử dụng `debtCounts`, `receivable`, `netReturnInputs` và `returnAdjustments`; bỏ phiếu thu huỷ, chỉ tính chứng từ đủ điều kiện. Duyệt kiểm lại trong transaction. Tạo đơn kiểm tra trước khi khởi tạo chứng từ.

`GET /quotes/:id/approval-preflight` kiểm quyền trang và phạm vi báo giá, trả đối chiếu nợ trước khi mở form tạo đơn/HĐKT. Không trả số liệu giá vốn cho nhân viên.

Thông báo công nợ là thẻ riêng có tên khách, ngày Việt Nam, tổng quá hạn và các chứng từ; không có thông tin giá vốn/CK nội bộ. Có thể chụp phần thẻ để gửi khách. Việc gửi cho khách do người dùng thực hiện.

## Kiểm tra

Test API có kiểm quyền, phí in bắt buộc, chi phí 0 hợp lệ, xác nhận cảnh báo, chặn tạo đơn/HĐKT và duyệt khi còn nợ, phiếu thu huỷ và khi trả đủ. Browser giả lập desktop/mobile kiểm tra thẻ không tràn, dữ liệu tên khách không thành HTML và nhập phí 0 lưu đúng revision. Chưa test live, chưa test máy in.
