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

Sau khi tháng kết thúc, Manager đối soát và **Duyệt điểm tháng**. Hệ thống lưu bản chụp và kiểm tra dữ liệu chưa thay đổi trước lúc duyệt. Không sửa các bản theo dõi thuộc tháng đã chốt. Việc nguồn có chỉnh sau đó không viết lại bản chụp.

## Triển khai

Migration thêm ba bảng metadata, không sửa/xóa dữ liệu nghiệp vụ: `20261108223847_warehouse_workspace.sql`. Bật RLS và thu hồi quyền trực tiếp của PUBLIC/anon/authenticated; API hiện có kiểm tra vai trò và quyền sở hữu. Chạy schema gate `scripts/sql/assert-warehouse-workspace.sql` trước API deploy. Không thay bucket hoặc quyền Storage.
