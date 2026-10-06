# Triển khai trực tiếp từ GitHub (không qua ChatGPT Sites)

Địa chỉ chính thức: **https://baogia.minhlongonline.com**

Sau khi cài một lần, mỗi lần `main` thay đổi GitHub Actions tự làm:
- **Giao diện** (`trial-ui/`) → **Cloudflare Pages** (`.github/workflows/deploy-ui.yml`), tự tạo dự án `baogia-bachngan` và gắn tên miền.
- **API** (Edge Function `baogia-v2-api`) → **Supabase** (`.github/workflows/deploy-api.yml`), chỉ sau khi typecheck + test xanh.
- Mỗi PR được kiểm tra tự động (`.github/workflows/ci.yml`).

Trang ChatGPT Sites cũ vẫn dùng được song song.

## Cài một lần: tạo 3 secret trên GitHub

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Không dán các giá trị này vào chat hay vào code.

| Secret | Lấy ở đâu |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → trang chủ tài khoản → cột phải **Account ID** (hoặc Workers & Pages → Overview) → *Copy* |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → biểu tượng người dùng → **My Profile → API Tokens → Create Token → Create Custom Token**. Quyền: **Account · Cloudflare Pages · Edit**; nếu `minhlongonline.com` đang quản lý trên Cloudflare thì thêm **Zone · DNS · Edit** (Zone Resources: *Specific zone* → `minhlongonline.com`). *Continue → Create Token → Copy* |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → **Generate new token** → *Copy* |

Sau đó: **Actions** → chạy **Triển khai giao diện** và **Triển khai API** (nút *Run workflow*, nhánh `main`).

## Tên miền baogia.minhlongonline.com
- Nếu `minhlongonline.com` quản lý trên Cloudflare: workflow tự tạo bản ghi DNS, chờ vài phút là vào được.
- Nếu quản lý ở nơi khác (Mắt Bão, PA Việt Nam, …): vào trang quản lý DNS ở đó thêm **CNAME** `baogia` → `baogia-bachngan.pages.dev`. HTTPS do Cloudflare cấp tự động.
- Chỉ dùng tên miền con `baogia.`: **không** đổi bản ghi của `minhlongonline.com` / `www` để không ảnh hưởng website đang chạy.
- Địa chỉ dự phòng luôn có: `https://baogia-bachngan.pages.dev`. Muốn cho địa chỉ này gọi API, thêm *repository variable* `APP_ORIGINS` = `https://baogia-bachngan.pages.dev` (tab Variables) rồi chạy lại **Triển khai API**.

## Ghi chú
- Liên kết kích hoạt / đặt lại mật khẩu trỏ về đúng trang mà Manager đang dùng khi tạo.
- Quay lại bản trước: Cloudflare → Workers & Pages → `baogia-bachngan` → Deployments → *Rollback*; API: Actions → chọn lần chạy cũ → *Re-run*.
- Thay đổi schema (migration) **không** tự áp; vẫn làm có kiểm soát theo `docs/SUPABASE.md`.
