# Yêu cầu cho Codex: đưa Báo giá v2 lên crm.minhlongonline.com

Người giao việc: chủ dự án (Bách Ngân). Soạn bởi Claude, 06/10/2026.
Mục tiêu: app báo giá v2 chạy ổn định ở **https://crm.minhlongonline.com**, với dữ liệu thật trên Supabase. Từ nay mọi thay đổi trên `main` phải tự triển khai lên đó, không qua ChatGPT Sites.

---

## 0. Quy tắc phối hợp (bắt buộc)

1. **`main` là bản chuẩn duy nhất.** Mọi thay đổi code đi qua nhánh riêng và PR, CI phải xanh rồi mới merge. Chỉ triển khai code **đã có trên `main`**. Không triển khai bản nằm ở máy cục bộ hay ở nhánh khác.
2. Thay đổi schema hoặc API thì ghi rõ trong mô tả PR. Migration chỉ được **thêm file mới** trong `migrations/postgres/`, không sửa file đã áp dụng.
3. Không đưa token, mật khẩu, cookie, `service_role` hay dữ liệu thật (SĐT, email khách) vào repo, PR hoặc chat.
4. Phân công: **Codex** lo dữ liệu và triển khai; **Claude** lo tính năng. Gặp điểm chưa rõ thì hỏi chủ dự án, không tự đoán.

## 1. Hiện trạng (06/10/2026)

| Hạng mục | Trạng thái |
| --- | --- |
| `main` | `f3c2837`: đã gộp PR #2, gồm toàn bộ PR #1 của Codex cộng với giao diện mới, trang Sản phẩm, nhập danh mục, bảng sản phẩm theo web cũ, ghi chú mặc định, hình ảnh. **PR #1 có thể đóng.** |
| PR #3 (`claude/upbeat-einstein-5vfnl4`) | **Mở, CI xanh.** Gồm: Edge Function cho phép gọi từ `https://crm.minhlongonline.com`; CI; tự triển khai API (`deploy-api.yml`); tự triển khai giao diện lên Cloudflare Pages kèm gắn tên miền (`deploy-ui.yml`); hướng dẫn `docs/TRIEN-KHAI.md`. |
| Supabase `taceqfnsorewelsbdckg` | 2.099 khách hàng và 20 chiết khấu theo thương hiệu đã có. **Sản phẩm: 0 dòng** (chưa nhập danh mục). |
| Edge Function `baogia-v2-api` | Đang chạy **bản 2, code cũ**, chưa có route sản phẩm mới, chưa cho phép tên miền `crm.`. |
| Giao diện đang chạy | chatgpt.site, bản cũ. Giữ song song cho tới khi `crm.` chạy ổn. |
| Tên miền | `baogia.minhlongonline.com` **đang dùng cho việc khác, không được đụng tới.** Dùng `crm.minhlongonline.com`. |

## 2. Việc cần làm (theo thứ tự)

### Bước 1. Merge PR #3
- Chủ dự án đã đồng ý dùng `crm.minhlongonline.com`. Review PR #3, kiểm tra CI xanh trên head mới nhất rồi merge vào `main` (merge commit, không rebase). Đóng PR #1.

### Bước 2. Secret trên GitHub (chủ dự án tạo, Codex hướng dẫn)
GitHub repo → Settings → Secrets and variables → Actions → *New repository secret*:

| Secret | Nguồn | Quyền tối thiểu |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens | token tài khoản |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com, ô **Account ID** | – |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Custom Token | Account · Cloudflare Pages · Edit; thêm **Zone · DNS · Edit** (chỉ zone `minhlongonline.com`) nếu tên miền quản lý trên Cloudflare |

Không có secret thì workflow chỉ cảnh báo rồi bỏ qua, không lỗi.

### Bước 3. Triển khai API từ `main`
- GitHub → Actions → **Triển khai API** → *Run workflow* trên `main`. Workflow chạy test trước, test xanh mới deploy.
- Nếu workflow lỗi ở bước deploy (vd do Supabase CLI), có thể deploy bằng Supabase MCP/CLI **từ đúng commit `main`**. Ghi lại commit đã deploy, và báo lỗi workflow để Claude sửa.
- Kiểm tra: gọi `GET https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/health` với header `Origin: https://crm.minhlongonline.com` phải trả `{"ok":true}`. Gọi với Origin lạ phải trả 403.

### Bước 4. Triển khai giao diện + tên miền
- Actions → **Triển khai giao diện** → *Run workflow*. Workflow sẽ:
  1. tạo dự án Pages `crm-minhlong` nếu chưa có;
  2. đưa `trial-ui/` lên;
  3. gắn tên miền `crm.minhlongonline.com`;
  4. tạo bản ghi CNAME `crm` nếu zone nằm trên Cloudflare.
- Nếu DNS **không** ở Cloudflare: thêm bản ghi **CNAME `crm` → `<địa chỉ *.pages.dev mà workflow in ra>`** tại nhà cung cấp tên miền.
- **Không sửa** các bản ghi `@`, `www`, `baogia`.
- Kiểm tra: https://crm.minhlongonline.com mở được trang đăng nhập và có ổ khoá HTTPS.

### Bước 5. Nhập danh mục sản phẩm (dữ liệu thật)
1. Đăng nhập web cũ, lấy JSON từ `GET /api/staff/catalog` (định dạng `sapo-catalog-v1`, đã gộp chỉnh sửa tay và tồn kho mới nhất).
2. Đăng nhập **https://crm.minhlongonline.com** bằng tài khoản **Manager** → trang **Sản phẩm** → **Nhập danh mục** → chọn file. Giao diện gửi theo lô 500 mã; lô cuối kèm `replaceAll` + `allSkus`.
3. Nhập lại nhiều lần đều an toàn: ghi đè giá và tồn, không tạo trùng, sản phẩm không còn trong file thì bị ẩn. Chi tiết trong `docs/NHAP-DU-LIEU.md`.
4. Không ghi thẳng vào bảng catalog bằng SQL trừ khi chủ dự án đồng ý. Nếu buộc phải ghi, làm đúng bảng và cột ghi trong `docs/NHAP-DU-LIEU.md`.

### Bước 6. Kiểm tra sau triển khai (báo kết quả từng mục)
- [ ] Đăng nhập Manager và nhân viên được; tài khoản NCC bị chặn.
- [ ] **Khách hàng**: trang báo tổng **2.099**; tìm không dấu (vd "cong ty") ra kết quả.
- [ ] **Sản phẩm**: số sản phẩm khớp web cũ; đối chiếu ít nhất 5 mã về giá theo từng bảng giá và tồn theo từng kho.
- [ ] **Soạn báo giá HRC**: các cột STT · Hình ảnh · Sản phẩm/Mã hàng · ĐVT · Số lượng · Đơn giá · CK (F6) · Đơn giá CK · Thành tiền, **không có Phí in**.
- [ ] **B2B / VIGIFTS**: có thêm **Phí in (F7)**, Bộ gồm, Mô tả in ấn, Đóng gói.
- [ ] Ghi chú & điều kiện mặc định đúng theo từng loại báo giá như web cũ.
- [ ] **Hình ảnh**: ảnh sản phẩm Sapo hiện trong danh sách và trong dòng báo giá; dán link Google Drive thì hiện ảnh. Nếu ảnh Sapo hoặc Drive **không** hiện, ghi rõ URL ảnh mẫu để Claude làm proxy ảnh qua Supabase Storage.
- [ ] Lưu báo giá, mở lại, sửa và lưu tiếp; hai người sửa cùng lúc thì người lưu sau nhận cảnh báo tải lại.
- [ ] In / lưu PDF khổ A4.
- [ ] Manager tạo nhân viên: liên kết kích hoạt phải bắt đầu bằng `https://crm.minhlongonline.com/login.html#…`.
- [ ] Đẩy một thay đổi nhỏ lên `main` qua PR. Hai workflow phải tự chạy và trang tự cập nhật.

### Bước 7. Báo lại cho chủ dự án và Claude
- Link các lần chạy Actions (CI, Triển khai API, Triển khai giao diện) và commit đã triển khai.
- Số sản phẩm đã nhập, số bảng giá, số kho; các mã bị lệch nếu có.
- Kết quả từng mục ở Bước 6, kèm ảnh chụp màn hình nếu có lỗi.
- Đề xuất ngày ngừng dùng trang chatgpt.site, khi `crm.` đã chạy ổn.

## 3. Không được làm
- Không force-push hay rebase `main`; không xoá nhánh của người khác.
- Không deploy code chưa merge vào `main`.
- Không sửa hay xoá migration đã áp dụng; không chạy lại migration lên project đã có schema.
- Không đổi DNS của `minhlongonline.com`, `www`, `baogia`.
- Không dán token hay mật khẩu vào chat, PR, issue hoặc code.

## 4. Tài liệu tham chiếu trong repo
- `docs/TRIEN-KHAI.md`: cài và triển khai (Cloudflare Pages, GitHub Actions, tên miền, quay về bản trước).
- `docs/NHAP-DU-LIEU.md`: bảng đích và cách nhập khách hàng, sản phẩm.
- `docs/SUPABASE.md`: cấu hình Supabase, Edge Function, Storage.
- `docs/ROADMAP.md`: lộ trình và các quyết định đã chốt.
- Chạy thử trên máy không cần Supabase: `npm ci && npm run ui:dev`, rồi mở http://localhost:8787 (đăng nhập `mgr@x.vn` / `mat-khau-12345`).
