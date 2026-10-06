# Đồng bộ Sapo → app (sản phẩm, khách hàng, nhân viên)

Sapo (`bachngankiengiang.mysapogo.com`) **tự gửi** dữ liệu mới sang app. App không đăng nhập vào Sapo và không ghi gì ngược lại Sapo.
Ba đường nhận giữ **đúng như web cũ**, nên luồng đang gửi sang web cũ chỉ cần đổi địa chỉ và mã bí mật.

Địa chỉ gốc: `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff`

| Dữ liệu | Đường dẫn (POST, JSON) | Nhận dạng gì | Mỗi lần tối đa |
| --- | --- | --- | --- |
| Sản phẩm | `/integrations/sapo/product` | webhook sản phẩm gốc của Sapo (1 sản phẩm kèm `variants`, `variant_prices`, `inventories`), hoặc `{products:[…]}` | 500 mã (SKU) |
| Khách hàng | `/integrations/sapo/customers` | `{observedAt, customers:[…]}` như web cũ, hoặc 1 khách Sapo gốc (`{customer:{…}}` / chính khách đó) | 500 khách |
| Nhân viên | `/integrations/sapo/staff` | `{observedAt, members:[…]}` như web cũ, hoặc `{accounts:[…]}` từ `/admin/accounts.json` của Sapo | 200 người |

## Mã bí mật (bắt buộc)

Mọi yêu cầu phải kèm mã `SAPO_SYNC_TOKEN` (≥ 32 ký tự ngẫu nhiên) theo **một** trong ba cách:
- header `Authorization: Bearer <mã>`, hoặc
- header `x-sapo-sync-token: <mã>` (header cũ `x-sapo-inventory-token` vẫn nhận), hoặc
- `?token=<mã>` trên địa chỉ: dùng cho webhook Sapo, vì Sapo không cho đặt header.

Sai hoặc thiếu mã thì app trả 401. App chưa cài mã thì trả 503 và không nhận gì. Phiên đăng nhập của Manager **không** dùng được cho các đường này.

**Cài mã (chủ dự án làm, một lần):**
1. Tạo một chuỗi ngẫu nhiên dài, ví dụ chạy `openssl rand -hex 32`, hoặc dùng trình tạo mật khẩu với 40 ký tự trở lên.
2. GitHub repo → Settings → Secrets and variables → Actions → *New repository secret*: tên `SAPO_SYNC_TOKEN`, giá trị là chuỗi vừa tạo.
3. Actions → **Triển khai API** → *Run workflow*. Workflow đưa mã lên Supabase rồi triển khai lại API.
4. Đưa cùng mã đó vào nơi gửi dữ liệu (bước dưới). Không dán mã vào chat, PR hay code.

## Nối Sapo vào app (Codex làm)

1. **Webhook sản phẩm của Sapo.** Sapo admin → Cấu hình → Webhook (hoặc ứng dụng đang gửi webhook sang web cũ). Thêm hoặc sửa webhook
   *Sản phẩm: tạo mới, cập nhật* trỏ về `…/api/staff/integrations/sapo/product?token=<mã>`.
2. **Khách hàng và nhân viên.** Luồng trung gian đang đẩy sang web cũ (`/integrations/sapo/customers`, `/integrations/sapo/staff`):
   thêm địa chỉ app mới với cùng nội dung, dùng header `Authorization: Bearer <mã>`. Webhook *Khách hàng: tạo mới/cập nhật* của Sapo
   trỏ thẳng về `…/integrations/sapo/customers?token=<mã>` cũng được.
3. Chạy song song với web cũ cho tới khi chuyển hẳn.
4. Kiểm tra: Manager mở trang **Nhân viên**. Ô **Đồng bộ Sapo** phải báo *Đang bật*, kèm số sản phẩm, khách hàng, nhân viên đã nhận và thời điểm lần cuối.

## Quy tắc ghi dữ liệu

**Sản phẩm** (theo SKU):
- Sản phẩm mới thì tạo; đã có thì cập nhật tên, thương hiệu, ĐVT, phân loại, ảnh Sapo, thuế.
- Trường nào Sapo để trống thì giữ giá trị đang có. Quy cách thùng nhập tay không bị ghi đè.
- Giá ghi theo **tên bảng giá**, tồn ghi theo **tên chi nhánh**, khớp với tên đã có trong app (do lần **Nhập danh mục** tạo ra).
  - Bảng giá hoặc kho chưa có trong app thì bỏ qua, không tự tạo, và kết quả trả về liệt kê ở `unknownPolicies` / `unknownWarehouses`. Ví dụ "Giá nhập" không bị lộ cho nhân viên.
  - Giá bán lẻ của biến thể điền vào bảng giá đầu tiên nếu Sapo không gửi riêng bảng đó.
- Sản phẩm hoặc biến thể ngừng bán thì **ẩn**, không xoá. Báo giá cũ vẫn mở được.

**Khách hàng** (theo mã Sapo, là số):
- Chỉ tạo khách **có MST** và không phải "khách lẻ", giống web cũ.
- Bản Sapo cũ hơn bản đang có thì bỏ qua (`updated_at`), vì webhook có thể đến không theo thứ tự.
- Khách tạo trên app (mã UUID) không bao giờ bị ghi đè.

**Nhân viên** (mã `SAPO-<id>`):
- Người mới được tạo với chức vụ **Sale** và chưa có mật khẩu. Manager bấm **Cấp lại liên kết** để gửi liên kết kích hoạt.
- Đã có tài khoản web cùng email thì **ghi liên kết** (`staff_sapo_links`) thay vì tạo trùng. Tài khoản web đó do Manager quản lý, đồng bộ không sửa.
- Nghỉ việc trên Sapo (`active: false`, `status: inactive|disabled|resigned…`) thì khoá hồ sơ `SAPO-…` và đăng xuất ngay. Người đã nghỉ không bao giờ được tạo mới.
- Đồng bộ chỉ cập nhật tên và SĐT. Chức vụ, quyền và trạng thái khoá do Manager quyết trên web; Manager đã khoá thì đồng bộ không mở lại.

Mọi lần gửi đều chạy được nhiều lần (idempotent). Gửi trùng không tạo dòng trùng.

## Chưa làm (đề xuất bước sau)
- Webhook **tồn kho** riêng (`inventory`) và đơn hàng Sapo.
- Nút **"Đồng bộ ngay"** để app tự kéo từ Sapo. Việc này cần cách đăng nhập Sapo ổn định (web cũ dùng cookie phiên admin, hết hạn sau vài giờ), nên cần chủ dự án chọn cách trước.
