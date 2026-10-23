# Link mời khách hàng và NCC tự đăng ký

Tại hồ sơ khách hàng, mở Tài khoản → Lấy link mời đăng ký. Tại hồ sơ NCC, Manager dùng Tạo tài khoản NCC · Lấy link đăng ký. Gửi riêng link cho người đại diện đúng hồ sơ; người có link có thể đăng ký thay mặt hồ sơ đó.

Người nhận mở `register.html`, kiểm tra tên khách/NCC đã gắn sẵn, tự nhập họ tên, email/số di động và mật khẩu. NCC đăng nhập bằng email; khách hàng có thể dùng email hoặc chỉ số di động. Đăng ký xong chuyển đến trang đăng nhập tương ứng. Link hiệu lực 24 giờ, chỉ dùng một lần. Cấp lại link làm link cũ vô hiệu. Tài khoản đã đăng ký vẫn dùng quy trình đặt lại mật khẩu hiện có.

API:
- POST `/customers/:id/invitations`: Manager hoặc người có quyền quản lý tài khoản của khách theo phạm vi hiện hành. Giữ quy tắc CK riêng chỉ Manager.
- POST `/suppliers/:id/invitations`: chỉ Manager. Có thể truyền `memberId` của lời mời chưa đăng ký để cấp lại.
- POST `/registration-info` và `/register-partner`: công khai nhưng bắt buộc token ngẫu nhiên hợp lệ, còn hạn và chưa dùng; giới hạn thử theo IP/token.

Token gồm phần ngẫu nhiên 256 bit và đích hồ sơ, lưu duy nhất SHA-256 trong credentials. Đổi loại/hồ sơ trong token làm sai hash; đổi gắn NCC cũng vô hiệu token cũ. Form công khai không quyết định vai trò, chức vụ, hồ sơ, người phụ trách hay CK. Token nằm ở fragment, được xoá khỏi thanh địa chỉ khi mở; không ghi vào localStorage. Đăng ký cập nhật identity/password trong transaction; kiểm trùng email và điện thoại khách, không chiếm tài khoản đã có.

Không thêm schema/migration. Lời mời chờ dùng staff_members + staff_credentials + liên kết khách/NCC hiện có, chưa có mật khẩu nên không đăng nhập được. Địa chỉ nội bộ của lời mời không hiển thị trên CRM; endpoint activate cũ không nhận lời mời. Các API cấp tài khoản/khôi phục cũ được giữ để tương thích.

Kiểm tra: typecheck và build UI qua. Nhóm API/tài khoản/portal/NCC/khôi phục cũ: 20 pass, 0 fail, 0 skip. Test UI đăng ký: 3 pass, 0 fail, 0 skip. Trong đó có 6 test API và 3 test UI mới. Chưa chạy toàn bộ suite cho thay đổi này; không tuyên bố kiểm thử cạnh tranh hai kết nối PostgreSQL thật.
