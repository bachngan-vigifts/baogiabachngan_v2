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
  - Khi khung chat mở: cuộc trò chuyện đang xem 3 giây một lần; danh sách cuộc trò chuyện 9 giây một lần, kể cả khi chưa chọn cuộc nào (điện thoại).
  - Khi khung chat đóng: số trên nút chat 15 giây một lần; có tin mới thì hiện thông báo "Có N tin nhắn mới". Có Web Push thì cập nhật ngay.
  - Lượt hỏi lùi mốc 2 phút và bỏ trùng theo id, để không sót tin hai người gửi cùng lúc.
- **Tốc độ**:
  - Mở một cuộc trò chuyện chỉ một lượt gọi `GET /chat/:id/messages?full=1&read=1` (tin + thông tin hội thoại + đánh dấu đã đọc).
  - Bấm vào cuộc trò chuyện hoặc chọn người ở "＋ Chat": khung chat hiện ngay (dùng dữ liệu danh sách / lần mở trước), tin nhắn nạp sau.
  - `POST /chat/direct` trả luôn tin nhắn + thông tin hội thoại, nên chọn người xong chỉ tốn một lượt gọi.
  - Danh bạ nhân viên được nạp sẵn khi mở khung chat, nên bấm "＋ Chat" là hiện danh sách ngay.
  - Gửi tin trả lời ngay; Web Push cho người nhận chạy nền (`EdgeRuntime.waitUntil`).
  - Edge Function dùng chung kết nối CSDL trong cả isolate, không mở kết nối mới mỗi request.
    - CSDL chỉ có 60 kết nối và `SUPABASE_DB_URL` là kết nối trực tiếp, nên mỗi isolate giữ tối đa 1 kết nối, nhả sau 10 giây rảnh.
    - CSDL báo hết chỗ kết nối thì chờ rồi thử lại tối đa 4 lần, lâu dần: 0,25 · 0,5 · 1 · 2 giây.
    - Tuỳ chọn: đặt secret `SUPABASE_POOLER_URL` (chuỗi kết nối Supavisor, chế độ *Transaction*, cổng 6543; lấy ở Supabase → Connect) thì Edge dùng pooler, mỗi isolate tối đa 3 kết nối.
  - Lượt làm mới danh sách bị lỗi mà danh sách đã có thì giữ danh sách cũ, không hiện khung lỗi.

## Thu hồi, tìm tin cũ, file, biểu tượng, tác vụ nhanh (migration `0037_chat_recall_files.sql`, `0038_supabase_access_chat_files.sql`)
- **Thu hồi:**
  - người gửi bấm ↩ trên tin của mình, trong vòng **4 giờ** (`POST /chat/:id/messages/:messageId/recall`);
  - nội dung, liên kết và file bị xoá (file xoá khỏi kho);
  - mọi người thấy "Tin nhắn đã được thu hồi". Khung đang mở của người khác nhận id tin bị thu hồi qua `recalledSince` khi hỏi tin mới.
- **Tìm tin cũ:** nút 🔍 ở danh sách hội thoại.
  - Tìm theo chữ (không dấu cũng được) và/hoặc khoảng ngày (giờ Việt Nam).
  - Tìm trong mọi hội thoại của mình hoặc chỉ hội thoại đang mở (`GET /chat/search?q=&from=&to=&conversationId=`); bỏ qua tin đã thu hồi.
  - Bấm kết quả thì mở hội thoại ngay quanh tin đó (`GET /chat/:id/messages?around=<thời điểm>`), tin được tô viền, có nút "Về tin mới nhất".
- **File đính kèm 📎:**
  - nhận ảnh, PDF, Excel, Word, CSV, TXT, ZIP; tối đa 3 file / tin, ≤ 6 MB / file;
  - ảnh chụp được nén trước khi gửi; dán ảnh chụp màn hình vào ô nhập cũng gửi được;
  - file lưu ở bucket **private** `baogiabachngan-v2-files` của Supabase Storage (khoá `chat/<hội thoại>/<tin>/…`), bảng `chat_attachments`;
  - người trong hội thoại nhận link tải ký tên có hạn 1 giờ;
  - Edge Function dùng `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` có sẵn của Supabase, không cần thêm secret;
  - migration 0038 cho bucket nhận thêm loại file Excel / Word / CSV / TXT / ZIP / GIF.
- **Biểu tượng 😊:** bảng biểu tượng hay dùng, chèn vào chỗ con trỏ.
- **Tác vụ nhanh ⚡:**
  - **Giao việc**: tạo việc cho người đang nhắn (nhóm: chọn người), kèm liên kết việc trong tin;
  - **gửi liên kết** đơn hàng, HĐKT, báo giá, phiếu đóng gói / xuất kho (cột `chat_messages.ref_json`);
  - người nhận bấm để mở; vẫn phải có quyền xem chứng từ đó.

## Cấu trúc
| Phần | File |
|---|---|
| Bảng `chat_conversations`, `chat_members` (có `last_read_at` để đếm tin chưa đọc), `chat_messages` (có `ref_json`, `recalled_at`), `chat_attachments` | `src/modules/chat/schema.ts` (migration `0018_chat.sql`, phân quyền `0019_supabase_access_chat.sql`) |
| Giới hạn, khoá hội thoại 1-1 | `src/modules/chat/domain/chat-config.ts` |
| API `/chat/*` | `src/modules/chat/api/routes.ts` |
| Kho file (Supabase Storage qua REST; bộ nhớ trong khi test / chạy thử) | `src/core/storage/file-store.ts` |
| Giao diện | `trial-ui/chat.js` + mục "Tin nhắn" trong `style.css` |

## Ảnh đại diện
- Mỗi người tự đổi ảnh ở menu tài khoản → "Đổi ảnh đại diện". Manager đổi / xoá ảnh của nhân viên trong "Chi tiết nhân viên" (bấm tên hoặc nút sửa ở trang Nhân viên).
- Trình duyệt cắt vuông, thu nhỏ 160 px JPEG (~10 KB) rồi gửi data URL; máy chủ chỉ nhận JPEG / PNG / WebP, kiểm tra chữ ký file, tối đa ~90 KB.
- Lưu ở bảng `staff_avatars` (một ảnh / người); `staff_members.avatar_key` là mã ảnh hiện tại, đổi mỗi lần thay ảnh (migration `0025_staff_avatars.sql`, phân quyền `0026_supabase_access_staff_avatars.sql`).
- API: `PUT/DELETE /avatar` (chính mình), `PUT/DELETE /admin/members/:id/avatar` (Manager), `GET /avatars?keys=a,b` (lấy nhiều ảnh một lượt).
- `/me`, `/admin/members`, `/chat/people`, thành viên hội thoại và tin nhắn đều trả `avatar` (mã ảnh hoặc `null`).
- Giao diện: `trial-ui/avatars.js`. Ô avatar nào có `data-av="<mã>"` tự được phủ ảnh; ảnh lưu đệm trong máy theo mã. Không có ảnh thì hiện chữ viết tắt.
