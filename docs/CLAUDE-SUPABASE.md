# Kết nối Supabase cho Claude Code

Quyết định của chủ dự án: v2 dùng Supabase PostgreSQL + Storage. Sapo nằm ngoài phạm vi bản dùng thử này. Ưu tiên báo giá, khách hàng và lưu dữ liệu thật trên Supabase.

- Repo: `bachngan-vigifts/baogiabachngan_v2`, PR #1, nhánh `codex/supabase-v2-trial`.
- Project ref: `taceqfnsorewelsbdckg`.
- Dashboard: https://supabase.com/dashboard/project/taceqfnsorewelsbdckg
- Project URL: `https://taceqfnsorewelsbdckg.supabase.co`.
- Bản dùng thử đã xuất bản: https://bachngan-baogia-v2.lucky-thyme-5212.chatgpt.site
- API: `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api`.
- Bucket private: `baogiabachngan-v2-files`. 62 bảng public bật RLS, chặn truy cập trực tiếp từ anon/authenticated; backend kiểm tra phân quyền staff.

## Xác thực trong Claude

Repo có `.mcp.json` cấu hình HTTP MCP giới hạn đúng project này, không có token bí mật. Kéo nhánh PR rồi mở `claude /mcp` trong terminal, chọn `supabase` > `Authenticate` và đăng nhập tài khoản Supabase của chủ dự án. Nếu môi trường Claude Code trên web không hỗ trợ xác thực MCP này, dùng connector Supabase trong Claude hoặc một môi trường Claude Code hỗ trợ OAuth. Quyền của plugin Supabase trong ChatGPT không tự chuyển sang Claude; cấu hình trong repo chưa phải bằng chứng Claude đã được cấp quyền.

Tài liệu chính thức: https://supabase.com/docs/guides/getting-started/mcp

## Nối giao diện với backend

Frontend ở `trial-ui/`. API dùng Origin của website trên; nếu đổi domain phải đổi Origin trong Edge Function rồi triển khai lại. Tất cả đường dẫn dưới đây nối sau API base.

| Yêu cầu | Dữ liệu |
| --- | --- |
| POST `/api/staff/activate` | `{token,password}`; chỉ dùng liên kết được cấp riêng |
| POST `/api/staff/login` | `{email,password}`; trả `user` và `sessionToken` |
| GET `/api/staff/me` | Phiên hiện tại |
| POST `/api/staff/logout` | Huỷ phiên |
| GET/POST `/api/staff/customers` | Danh sách/tạo khách hàng |
| PUT `/api/staff/customers/:id` | Sửa khách hàng |
| GET/POST `/api/staff/quotes` | Danh sách/tạo báo giá |
| GET `/api/staff/quotes/:id` | `{id,revision,data}` |
| PUT `/api/staff/quotes/:id` | `{revision,data}`; 409 nếu bản cũ hoặc không được sửa |

Gửi `Authorization: Bearer <sessionToken>` cho route riêng tư. Đây là phiên staff của ứng dụng, không phải JWT Supabase Auth. Không dùng Supabase Data API trực tiếp cho bảng nghiệp vụ. Edge Function dùng `SUPABASE_DB_URL` được nền tảng cấp sẵn. Không đưa service_role, secret key, cookie, mật khẩu hoặc token kích hoạt vào frontend, tài liệu hay repo.

## Phần tiếp theo

Nhánh `claude/demo` hiện dùng dữ liệu mẫu. Khi tích hợp, thay lớp dữ liệu mẫu bằng API ở trên, giữ các hàm tính giá và phân quyền đã kiểm thử. Bản đã xuất bản có đăng nhập, danh bạ, tạo/sửa báo giá và in PDF; cổng NCC và upload file chưa mở. Không tự áp lại migration vào project đã có schema; trước tiên kiểm tra trạng thái và xem `docs/SUPABASE.md`.

Kiểm tra backend: `npm run typecheck`, `npm test`. Kết quả trước xuất bản: 173 pass, 0 fail, 30 test legacy skipped. Kiểm tra thực tế giao diện cần tài khoản được kích hoạt riêng.
