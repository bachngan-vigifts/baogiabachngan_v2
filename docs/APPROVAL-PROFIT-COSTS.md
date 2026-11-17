# Kiểm tra chi phí trước khi duyệt đơn / HĐKT

Manager mở **Duyệt đơn** và điền **Nhập đủ chi phí trước khi duyệt**:

1. Kiểm tra giá nhập chưa VAT của **từng sản phẩm**, theo đúng đơn vị tính. Giá có sẵn từ báo giá hoặc nguồn giá vốn sẽ được điền để đối chiếu. Khi Manager xác nhận giá từ nguồn bổ sung, giá đó được lưu thành giá nhập đã xác nhận trên báo giá.
2. Nếu có in/khắc, nhập **chi phí mua dịch vụ**, không lấy phí in bán cho khách làm chi phí. Đơn có mô tả in logo vẫn cần khai báo chi phí khi miễn phí in cho khách. Chấp nhận số 0 được nhập và xác nhận rõ ràng; ô trống không phải số 0.
3. Chọn **Khách trả / khách tự nhận** hoặc **Công ty chịu phí**. Nếu công ty chịu thì phải nhập tổng chi phí vận chuyển chưa VAT lớn hơn 0. Cước dự toán từ kích thước thùng không thay cho khoản khai báo này.
4. Kiểm tra CK khách và đánh dấu các mục xác nhận, bấm **Lưu chi phí và tiếp tục**, rồi kiểm tra thông tin đơn và kho trước khi duyệt.

Bấm quay lại ở popup chi phí sẽ không lưu. Sau khi lưu chi phí, nếu huỷ bước duyệt cuối thì chi phí vẫn nằm trên báo giá nhưng đơn chưa được duyệt. Nếu báo giá đổi sau khi kiểm tra, mở lại luồng duyệt để lấy dữ liệu mới.

Người được chỉ định duyệt không tự có quyền xem/sửa giá vốn. Nếu thiếu chi phí, nhờ Manager bổ sung; đủ chi phí thì có thể tiếp tục duyệt theo quyền hiện có. Đơn cũ thiếu báo giá nguồn hoặc sai khớp mã/tên hàng bị chặn để đối chiếu, không tự đoán giá bằng 0.

Chi phí vận chuyển khai báo được tính vào lợi nhuận trước khi có cước chuyến giao. Khi đã có tổng cước thực tế dương của các chuyến chưa huỷ, báo cáo dùng cước thực tế thay cho khoản khai báo, không cộng hai lần. POS giữ quy trình riêng.

Không cần migration mới: khoản khai báo nằm trong `shipping.cost` của JSON báo giá hiện có. API vẫn kiểm tra các khoản bắt buộc trong giao dịch duyệt; `costWarningsReviewed: true` không bỏ qua chi phí thiếu. Chi phí không được trả cho người không phải Manager.
