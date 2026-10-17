# Triển khai trực tiếp từ GitHub (không qua ChatGPT Sites)

Địa chỉ chính thức: **https://crm.minhlongonline.com**

Sau khi cài một lần, mỗi lần `main` thay đổi GitHub Actions tự làm:
- **Giao diện** (`trial-ui/`) → **Cloudflare Pages** (`.github/workflows/deploy-ui.yml`), tự tạo dự án `crm-minhlong` và gắn tên miền.
  - Lúc triển khai, mọi đường dẫn JS / CSS được gắn số phiên bản (`app.js?v=<commit>`, kể cả `import` giữa các module; `scripts/stamp-ui-version.ts`). Bản mới luôn có URL mới nên máy người dùng không chạy lẫn file cũ và mới. Trong repo vẫn để đường dẫn gốc (chạy thử trên máy không cần bước này).
- **Proxy API** (`functions/api/staff/[[path]].js`, Cloudflare Pages Function) lên cùng giao diện: `https://crm.minhlongonline.com/api/staff/*` → Edge Function. Xem mục *Phiên đăng nhập* bên dưới.
- **API** (Edge Function `baogia-v2-api`) → **Supabase** (`.github/workflows/deploy-api.yml`), chỉ sau khi typecheck + test xanh.
- Mỗi PR được kiểm tra tự động (`.github/workflows/ci.yml`).

Trang ChatGPT Sites cũ vẫn dùng được song song.

## Cài một lần: tạo secret trên GitHub

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Không dán các giá trị này vào chat hay vào code.

| Secret | Lấy ở đâu |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → trang chủ tài khoản → cột phải **Account ID** (hoặc Workers & Pages → Overview) → *Copy* |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → biểu tượng người dùng → **My Profile → API Tokens → Create Token → Create Custom Token**. Quyền: **Account · Cloudflare Pages · Edit**; nếu `minhlongonline.com` đang quản lý trên Cloudflare thì thêm **Zone · DNS · Edit** (Zone Resources: *Specific zone* → `minhlongonline.com`). *Continue → Create Token → Copy* |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → **Generate new token** → *Copy* |
| `API_PROXY_SECRET` (nên có) | Tự tạo chuỗi ngẫu nhiên ≥ 32 ký tự (vd `openssl rand -hex 32`). Hai workflow cùng đặt nó cho proxy (Cloudflare) và Edge Function (Supabase) – xem *Phiên đăng nhập*. |

Sau đó: **Actions** → chạy **Triển khai giao diện** và **Triển khai API** (nút *Run workflow*, nhánh `main`).

## Tên miền crm.minhlongonline.com
- Nếu `minhlongonline.com` quản lý trên Cloudflare: workflow tự tạo bản ghi DNS, chờ vài phút là vào được.
- Nếu quản lý ở nơi khác (Mắt Bão, PA Việt Nam, …): vào trang quản lý DNS ở đó thêm **CNAME** `crm` → `crm-minhlong.pages.dev`. HTTPS do Cloudflare cấp tự động.
- Chỉ dùng tên miền con `crm.`: **không** đổi bản ghi của `minhlongonline.com`, `www`, `baogia` (đang dùng cho việc khác) để không ảnh hưởng các trang đang chạy.
- Nếu Cloudflare báo tên `crm-minhlong.pages.dev` đã có người dùng, nó tự thêm hậu tố; workflow in ra địa chỉ thật ở bước *Gắn tên miền* – dùng đúng địa chỉ đó cho CNAME.
- Địa chỉ dự phòng luôn có: `https://crm-minhlong.pages.dev`. Muốn cho địa chỉ này gọi API, thêm *repository variable* `APP_ORIGINS` = `https://crm-minhlong.pages.dev` (tab Variables) rồi chạy lại **Triển khai API**.

## Phiên đăng nhập (cookie first-party)
Ràng buộc bảo mật: **không** lưu token trong localStorage / sessionStorage và **không** trả token trong JSON.
- Giao diện gọi API ở **chính tên miền của nó** (`/api/staff/*`). Pages Function `functions/api/staff/[[path]].js` chuyển tiếp tới Edge Function `baogia-v2-api`, giữ nguyên `Set-Cookie`. Cookie `__Host-bn-session` (HttpOnly, Secure, SameSite=Strict, Path=/) vì vậy là cookie **first-party** của `crm.minhlongonline.com`: Safari / iPhone (cả app thêm vào màn hình chính) không chặn như cookie bên thứ ba. JavaScript không đọc được token.
- Phiên 30 ngày, **trượt**: còn dùng thì máy chủ gia hạn phiên (tối đa 1 lần/ngày) và gửi lại cookie với Max-Age 30 ngày mới. Chỉ bấm Đăng xuất, đổi mật khẩu hoặc bỏ app quá 30 ngày mới phải đăng nhập lại.
- Proxy luôn ghi `Origin` của trang (GET cùng nguồn trình duyệt không gửi Origin) và từ chối yêu cầu mang Origin khác.
- Giới hạn số lần đăng nhập theo IP: yêu cầu từ Cloudflare Worker tới Supabase mang IP của Worker, nên proxy gửi kèm IP thật cùng mã bí mật `API_PROXY_SECRET`; Edge Function chỉ tin IP đó khi mã khớp. **Chưa đặt secret này thì mọi người dùng chung một IP** cho bộ đếm 100 lần / 15 phút của màn đăng nhập.
- Chuyển tiếp: máy còn token cũ trong localStorage gửi nó (Bearer) **một lần** ở yêu cầu đầu tiên rồi xoá; Edge Function đặt cookie cho token đó nên người dùng không phải đăng nhập lại. Sau ~30 ngày có thể bỏ nhánh Bearer trong `src/modules/staff/api/edge-session.ts`.
- Trang ChatGPT Sites cũ đọc `sessionToken` trong JSON nên **không đăng nhập được nữa**; dùng `crm.minhlongonline.com`.
- Địa chỉ `*.pages.dev` cũng có proxy, nhưng Edge Function chỉ nhận Origin có trong danh sách (thêm qua `APP_ORIGINS`).
- Kiểm tra trên iPhone sau khi triển khai: Safari và app ngoài màn hình chính → đăng nhập → tắt hẳn app, mở lại (vẫn vào thẳng) → Đăng xuất (về form đăng nhập) → đăng nhập lại. Safari → Cài đặt → Safari → Nâng cao → Dữ liệu trang web: chỉ thấy cookie của `minhlongonline.com`, không có `supabase.co`.

## Ghi chú
- Liên kết kích hoạt / đặt lại mật khẩu trỏ về đúng trang mà Manager đang dùng khi tạo.
- Quay lại bản trước: Cloudflare → Workers & Pages → `crm-minhlong` → Deployments → *Rollback*; API: Actions → chọn lần chạy cũ → *Re-run*.
- Thay đổi schema (migration) **không** tự áp; vẫn làm có kiểm soát theo `docs/SUPABASE.md`.
