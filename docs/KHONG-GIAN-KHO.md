# Không gian Kho

Mở **Kho & giao hàng → Kho của tôi** (`#/kho`). Nhân viên Kho chỉ thao tác việc của mình và nhận việc nhóm chưa có người nhận. Manager chọn từng nhân viên để đối soát. Các chức vụ khác và NCC không truy cập API này.

## Thiết lập lần đầu

1. Manager mở **Cài đặt ca & thưởng**, khai báo giờ làm, giờ nghỉ và ngày làm trong tuần. Không dùng ca giả định. Ca qua đêm chưa hỗ trợ; nhập ca trong một ngày.
2. Quỹ thưởng là tuỳ chọn, chỉ để xem dự kiến. Chưa nối khoản này vào lương và chưa tự điều chỉnh theo ngày công. Để trống khi chưa thống nhất mức thưởng.
3. Giao việc qua Công việc; chọn người Kho hoặc nhóm Kho và đặt hạn. Các việc nghiệp vụ hiện có vẫn giữ nguồn ban đầu.
4. Chọn **Giao định mức** trên từng việc: người phụ trách, loại việc, điểm khối lượng, tổng thời gian chuẩn và căn cứ định mức. Định mức/ca/hạn được chụp lại, không đổi sau khi bắt đầu. Ca mới chỉ áp dụng cho định mức mới.

## Làm và duyệt việc

- **Nhận việc** cho việc nhóm chưa ai nhận; chỉ một người nhận thành công.
- **Bắt đầu**: máy chủ ghi thời gian. Mỗi người chỉ có một việc đang làm.
- **Báo vướng mắc**: nhập lý do; **Tiếp tục làm** kết thúc khoảng chờ. Thời gian chờ vẫn tính cho tới khi Manager duyệt loại trừ.
- **Hoàn thành**: nhập kết quả/bằng chứng bàn giao, chuyển sang Chờ xác nhận. Với nghiệp vụ tự sinh, hoàn tất phiếu gốc trước khi Manager xác nhận. Thao tác ở đây không tự ghi tồn kho hoặc đẩy đơn Sapo.
- Manager duyệt khoảng chờ, chọn chất lượng và xác nhận; hoặc yêu cầu làm lại. Thời gian chờ Manager trả kết quả được loại trừ khi yêu cầu làm lại; lỗi lần đầu vẫn được ghi nhận.

Việc đã đưa vào theo dõi không sửa/xóa từ trang Công việc cũ. Manager có thể **Hủy việc thủ công** tại Không gian Kho với lý do; bản theo dõi được giữ lại. Phiếu nghiệp vụ vẫn hủy theo luồng gốc.

## Điểm và chốt tháng

30% đúng hạn + 25% tốc độ + 25% hoàn thành + 20% chất lượng. Các tỷ lệ có trọng số theo điểm khối lượng. Tốc độ tối đa 100%; chỉ thời gian trong ca và ngoài giờ nghỉ được tính. Việc đến hạn chưa hoàn thành vẫn nằm trong mẫu số. Việc huỷ không tính. Việc xác nhận sớm trong tháng được tính ngay; việc chưa đến hạn khác chưa tính. Tháng dựa trên hạn gốc theo giờ Việt Nam.

Thiếu định mức, thời gian hợp lệ, hoặc còn kết quả/khoảng chờ cần duyệt thì không tự gán điểm. Công việc đã hoàn tất trước lần bật cài đặt đầu tiên được hiển thị là dữ liệu cũ, không bịa lại thời gian xử lý.

Hệ số thưởng dự kiến: từ 90 điểm hưởng 100% quỹ; 80–dưới 90 hưởng 80%; 70–dưới 80 hưởng 50%; dưới 70 hưởng 0%. Đây là dự kiến đủ công; không thay lương cơ bản và chưa tạo khoản thưởng lương.

Sau khi tháng kết thúc, Manager đối soát và **Duyệt điểm tháng**. Hệ thống lưu bản chụp và kiểm tra dữ liệu chưa thay đổi trước lúc duyệt. Không sửa định mức của kỳ đã chốt. Công việc còn dở vẫn được tiếp tục và xác nhận hoàn thành; bản chụp điểm/thưởng của tháng đã duyệt giữ nguyên, không tính lại hoặc thưởng trùng sang tháng sau. Việc nguồn có chỉnh sau đó không viết lại bản chụp.

## Triển khai

Migration thêm ba bảng metadata, không sửa/xóa dữ liệu nghiệp vụ: `20261108223847_warehouse_workspace.sql`. Bật RLS và thu hồi quyền trực tiếp của PUBLIC/anon/authenticated; API hiện có kiểm tra vai trò và quyền sở hữu. Chạy schema gate `scripts/sql/assert-warehouse-workspace.sql` trước API deploy. Không thay bucket hoặc quyền Storage.

## Demo tháng đang chạy

Manager chọn tháng hiện tại theo giờ Việt Nam và nhân viên Kho, bấm **Chạy demo tháng này → Chạy demo**. Popup trả điểm, thưởng dự kiến và phần còn thiếu theo dữ liệu thật. Nếu chưa đủ dữ liệu thì giữ trạng thái chưa tính được, không giả định 0 điểm.

Demo chỉ đọc dữ liệu, không lưu bản chốt, không khóa tháng và không cộng vào lương. Có thể sửa công việc/cấu hình rồi chạy lại. Tháng tương lai chưa demo; tháng đã kết thúc dùng quy trình **Duyệt điểm tháng** chính thức như trước.

## Lọc nhân viên và việc nhóm

Manager chọn tên nhân viên để xem riêng công việc, số đếm và hiệu suất của người đó. **Việc nhóm chưa giao** là lựa chọn riêng để giao định mức/người nhận; không cộng vào thẻ thống kê của từng nhân viên. Tài khoản Kho vẫn thấy việc của mình cùng việc nhóm có thể nhận. Bộ lọc giữ nguyên khi chuyển tab/tháng và đặt lại trang danh sách về trang đầu khi đổi nhân viên.

## Điểm khối lượng mặc định

Mỗi việc chưa cấu hình có mặc định **1 điểm khối lượng**. Form Giao định mức tự điền 1; bỏ trống điểm cũng lưu 1. Manager vẫn có thể nhập trọng số riêng khi cần; các định mức và bản chốt đã lưu được giữ nguyên. Điểm mặc định không thay thế **thời gian chuẩn**: vẫn cần duyệt số phút chuẩn để tính tốc độ, cùng thời gian bắt đầu/hoàn thành và xác nhận chất lượng để tính hiệu suất.
