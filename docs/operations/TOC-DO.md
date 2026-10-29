# Tốc độ tải trang CRM

## Đã làm (đợt 1)

| Chỗ chậm | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Mở app / tải lại trang | `_headers` đặt `Cache-Control: no-cache` cho mọi JS / CSS. Mỗi lần mở app, trình duyệt hỏi lại máy chủ từng module (app.js → hàng chục `import` → module con…), từng tầng nối đuôi nhau. | Mọi tham chiếu JS / CSS đều có `?v=<commit>` khi triển khai (`scripts/stamp-ui-version.ts`, nay phủ cả thư viện PDF / Excel / quét mã nạp động). `_headers` cho `*.js` / `*.css` giữ 1 năm (`immutable`). Bản mới = URL mới nên không kẹt bản cũ. `index.html` và file khác vẫn luôn hỏi lại. Test `stamp-ui-version.test.ts` chặn file JS / CSS nào lọt không có phiên bản. |
| Trang đang mở phải chờ | Mở app bắn ~17–20 API cùng lúc (số đếm menu, chuông, nhịp kiểm tra, duyệt, danh sách báo giá / khách dù đang ở trang khác, bản chụp so sánh…). Mỗi bản Edge chỉ có 1 kết nối CSDL (chế độ trực tiếp), nên danh sách của trang đang xem xếp hàng sau các số đếm. | `trial-ui/request-priority.js`: dữ liệu trang đang mở đi trước; lời gọi phụ chờ trang chính xong (tối đa 4 giây), tối đa 3 lời gọi phụ cùng lúc. Danh sách báo giá / khách / nhân viên của trang khác tải sau. Lượt chụp mốc so sánh lúc mở app không đọc lại danh sách vừa tải. Giả lập 1 kết nối, mỗi API 150 ms: trang Két xong 0,74 s thay vì 2,9 s. |
| Phản hồi lớn | Edge phân tích JSON rồi ghi lại (danh mục ~3 MB) chỉ để thêm `sessionToken`. Chỉ nén gzip khi > 100 KB. | Chuyển nguyên văn bản, chỉ sửa JSON khi đăng nhập / đổi phiên. Nén gzip từ 4 KB (danh sách 20–200 KB còn khoảng 1/5). |
| Không biết chậm ở đâu | Không có số đo. | Header `Server-Timing` trên mọi phản hồi API: `db` (chờ kết nối CSDL), `app` (xử lý + số truy vấn), `total`, `region` (vùng chạy Edge). Yêu cầu > 1,5 giây ghi log `API slow` (đã bỏ mã / query string). Menu tài khoản → **Đo tốc độ** tách mạng / máy chủ / CSDL cho từng API, có nút sao chép để gửi. |

## Việc anh cần làm: bật transaction pooler (quan trọng nhất phía máy chủ)

Hiện GitHub **chưa có** secret `SUPABASE_POOLER_URL`: bước "Cấu hình transaction pooler" trong *Triển khai API* luôn bị bỏ qua. Nếu trên Supabase cũng chưa đặt secret này, mỗi lần gọi API, Edge phải:
- mở kết nối Postgres mới (TCP + TLS + xác thực);
- chạy thêm `select 1`;
- đóng kết nối ngay sau đó.

Mỗi bản Edge cũng chỉ được 1 kết nối, vì CSDL giới hạn 60 kết nối (sự cố 26/10, xem `API-CONNECTION-RECOVERY.md`). Không nới giới hạn này.

Pooler (Supavisor, chế độ transaction) giữ kết nối sẵn. Mỗi bản Edge dùng tối đa 3 kết nối mà không làm cạn 60 kết nối của CSDL.

1. Supabase → project → nút **Connect** → tab **Connection string** → chọn **Transaction pooler** (cổng **6543**). Copy chuỗi `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:6543/postgres`, thay `[YOUR-PASSWORD]` bằng mật khẩu CSDL.
2. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**: tên `SUPABASE_POOLER_URL`, giá trị là chuỗi trên. Không dán chuỗi này vào chat.
3. Actions → **Triển khai API** → *Run workflow*. Bước "Cấu hình transaction pooler" phải chạy (không còn *skipped*).
4. Kiểm tra: menu → **Đo tốc độ**, cột "Chờ CSDL" phải giảm rõ, thường còn vài ms sau lượt đầu.

## Đọc số đo

- **Chờ CSDL** cao (hàng trăm ms) ở mọi API: do mở kết nối mới mỗi lần. Bật pooler như trên.
- **Máy chủ** cao, **số truy vấn** lớn ở một API: API đó cần gộp truy vấn hoặc thêm chỉ mục. Gửi bảng cho người hỗ trợ.
- **Mạng** cao, máy chủ thấp: do đường truyền / vị trí. Xem cột vùng (`region`). Nếu Edge chạy ở vùng xa CSDL, có thể buộc Edge chạy cùng vùng CSDL (đợt sau).
- Log chậm: Supabase → Edge Functions → `baogia-v2-api` → Logs, tìm `API slow`.
