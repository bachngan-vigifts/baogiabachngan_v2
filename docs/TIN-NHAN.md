# Tin nhắn nội bộ

**Nút chat nổi** ở góc dưới bên phải mọi trang mở khung **Tin nhắn** để nhân viên nhắn cho nhau. Bấm thông báo tin nhắn (`#/chat/<id>`) mở đúng cuộc trò chuyện, trang đang xem giữ nguyên. Esc hoặc nút × để đóng. Khách hàng và NCC không dùng được.

## Dùng
- **＋ Chat**: chọn một đồng nghiệp để nhắn 1-1. Mỗi cặp nhân viên chỉ có một cuộc trò chuyện.
- **＋ Nhóm**: đặt tên nhóm và chọn thành viên.
- **Quản lý nhóm** (nút **Thành viên**):
  - Người tạo nhóm hoặc Manager đổi được tên nhóm, thêm hoặc bớt người.
  - Ai cũng tự rời nhóm được.
  - Các thay đổi này hiện thành dòng thông báo trong khung chat.
- **Gõ tin**: Enter để gửi, Shift+Enter để xuống dòng.
- **Liên kết**: dán `#/orders/<id>`, `#/quotes/<id>`… hoặc http… thì tin hiện thành liên kết bấm được.
- **Hiển thị trong khung chat**:
  - Tin chia nhóm theo ngày.
  - Tin liền nhau của cùng một người (cách nhau dưới 5 phút) gộp thành một cụm.
  - Chat 1-1 có dòng "Đã xem" dưới tin mình gửi khi người kia đã đọc.
- **Tin chưa đọc**: số đỏ trên nút chat nổi, và số trên từng cuộc trò chuyện.
- **Thông báo**: tin mới được đẩy qua Web Push. Tin nhắn không hiện trong chuông thông báo vì đã có hộp thư riêng.
- **Cập nhật tin mới**: lấy theo chu kỳ, không cần tải lại trang.
  - Cuộc trò chuyện đang mở: 3 giây một lần.
  - Danh sách cuộc trò chuyện: 10 giây một lần.
  - Số trên nút chat: 20 giây một lần. Có Web Push thì cập nhật ngay.

## Cấu trúc
| Phần | File |
|---|---|
| Bảng `chat_conversations`, `chat_members` (có `last_read_at` để đếm tin chưa đọc), `chat_messages` | `src/modules/chat/schema.ts` (migration `0018_chat.sql`, phân quyền `0019_supabase_access_chat.sql`) |
| Giới hạn, khoá hội thoại 1-1 | `src/modules/chat/domain/chat-config.ts` |
| API `/chat/*` | `src/modules/chat/api/routes.ts` |
| Giao diện | `trial-ui/chat.js` + mục "Tin nhắn" trong `style.css` |
