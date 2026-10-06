# Triển khai trực tiếp từ GitHub (không qua ChatGPT Sites)

Sau khi cài một lần, mỗi lần `main` thay đổi:
- **Giao diện** (`trial-ui/`) tự lên **Cloudflare Pages**.
- **API** (Edge Function `baogia-v2-api`) tự lên **Supabase** qua GitHub Actions (`.github/workflows/deploy-api.yml`), chỉ sau khi typecheck + test xanh.
- Mỗi PR được kiểm tra tự động (`.github/workflows/ci.yml`).

Trang ChatGPT Sites cũ vẫn dùng được song song cho tới khi anh muốn tắt.

## 1. Giao diện – Cloudflare Pages (miễn phí, ~5 phút)
1. Vào https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Chọn GitHub, cấp quyền cho repo `bachngan-vigifts/baogiabachngan_v2`.
3. Cấu hình:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: *(để trống)*
   - Build output directory: `trial-ui`
4. **Save and Deploy**. Cloudflare cho địa chỉ tạm dạng `https://<tên-dự-án>.pages.dev`.
5. **Tên miền chính thức `baogia.minhlongonline.com`**: trong dự án Pages → **Custom domains** → *Set up a custom domain* → nhập `baogia.minhlongonline.com`.
   - Nếu DNS của `minhlongonline.com` đang ở Cloudflare: Cloudflare tự tạo bản ghi, chỉ cần xác nhận.
   - Nếu DNS ở nơi khác (nhà cung cấp tên miền): thêm bản ghi **CNAME** `baogia` → `<tên-dự-án>.pages.dev` tại trang quản lý DNS đó, rồi quay lại Cloudflare chờ trạng thái *Active* (vài phút đến vài giờ). HTTPS được cấp tự động.
   - Chỉ dùng tên miền con `baogia.`: **không** đổi bản ghi của `minhlongonline.com` / `www` để không ảnh hưởng website đang chạy.

## 2. Cho phép trang mới gọi API
GitHub repo → **Settings → Secrets and variables → Actions**:
- Tab **Secrets** → *New repository secret*: `SUPABASE_ACCESS_TOKEN` = token tạo ở https://supabase.com/dashboard/account/tokens (*Generate new token*). Không dán token vào chat hay vào code.
- `https://baogia.minhlongonline.com` đã được cho phép sẵn trong code. Muốn dùng thêm địa chỉ tạm `*.pages.dev`: tab **Variables** → *New repository variable* `APP_ORIGINS` = `https://<tên-dự-án>.pages.dev` (nhiều địa chỉ cách nhau bằng dấu phẩy, không có `/` ở cuối). Không bắt buộc.

## 3. Chạy lần đầu
GitHub repo → **Actions** → **Triển khai API** → **Run workflow** (nhánh `main`). Xong bước này mở **https://baogia.minhlongonline.com** và đăng nhập bằng tài khoản đang dùng.

## Ghi chú
- Liên kết kích hoạt / đặt lại mật khẩu trỏ về đúng trang mà Manager đang dùng khi tạo.
- Muốn quay lại bản trước: Cloudflare Pages → Deployments → *Rollback*; API: chạy lại workflow trên commit cũ (Actions → chọn lần chạy cũ → *Re-run*).
- Thay đổi schema (migration) **không** tự áp; vẫn làm có kiểm soát theo `docs/SUPABASE.md`.
