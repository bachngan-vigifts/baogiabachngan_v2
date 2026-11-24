# Đồng bộ Sapo → app (sản phẩm, khách hàng, nhân viên)

Có hai cách, dùng song song được, cùng một quy tắc ghi (mục *Quy tắc ghi dữ liệu*):
1. **App tự lấy** bằng phiên đăng nhập Sapo của Manager. Sapo hiện không cấp token API nên đây là cách chính.
2. **Sapo / luồng trung gian đẩy sang**: webhook như web cũ (mục *Nhận dữ liệu đẩy*).

## 1. App tự lấy bằng phiên Sapo của Manager
- Manager vào **Nhân viên → Đồng bộ Sapo → Kết nối Sapo**. Trên Chrome/Edge máy tính, có thể cài [tiện ích Kết nối Sapo](SAPO-CHROME-CONNECTOR.md) một lần, mở Sapo đăng nhập rồi bấm **Kết nối phiên vào CRM**. Cách dán cookie thủ công vẫn ở mục thu gọn trong hộp thoại.
  - App gọi thử Sapo trước, phiên dùng được mới lưu.
  - Cookie được **mã hoá AES-GCM** (khoá dẫn xuất từ secret `SAPO_SYNC_TOKEN`, không nằm trong DB) và không bao giờ trả về trình duyệt.
- Đồng bộ **chỉ đọc** Sapo (GET). CRM không ghi gì vào Sapo; tạo đơn Sapo do n8n → OpenClaw làm (mục 3).
- Các đường đọc:
  - `/accounts.json` lấy nhân viên,
  - `/customers.json` lấy khách hàng,
  - `/products.json` lấy sản phẩm,
  - `/locations.json` lấy tên chi nhánh để ghép tồn kho.

  App đọc mỗi trang 250 dòng, tối đa 12 trang mỗi loại mỗi lần chạy, lần sau đọc tiếp. Từ lần thứ hai app chỉ lấy bản ghi sửa sau lần trước: gửi kèm `modified_on_min` và lọc lại phía app.
- **Khi nào chạy:**
  - Nút **Đồng bộ ngay**.
  - Lịch trong Supabase (`pg_cron` + `pg_net`, file `supabase/sapo-cron.sql`): **giữ phiên 10 phút/lần**, **lấy dữ liệu 30 phút/lần** (phút 7 và 37). Không tốn phút GitHub Actions.
    - Chủ dự án tự chạy file này **một lần** trong Supabase → SQL Editor, sau khi thay chỗ `DAN_MA_BI_MAT_VAO_DAY` bằng giá trị `SAPO_SYNC_TOKEN`. Mã được lưu trong Supabase Vault.
    - Đổi mã thì chạy lại file với mã mới.
  - Workflow `.github/workflows/sapo-pull.yml` chỉ còn để chạy tay khi cần.
  - Khoá 5 phút chống hai lượt chạy chồng nhau.
- **Giữ phiên tự động:** mỗi lần app gọi Sapo (đồng bộ, hoặc `POST …/integrations/sapo/keepalive`), cookie mới Sapo cấp qua `Set-Cookie` được gộp và lưu lại (mã hoá). Bản đã lưu chỉ bị ghi đè khi Manager chưa kết nối lại trong lúc đó. Phiên hỏng thì giữ nguyên bản đã lưu.
- **Phiên hết hạn:** ô trạng thái báo *Phiên hết hạn*, Manager bấm **Kết nối lại**. Lịch tự động chỉ cảnh báo, không đánh đỏ liên tục.
- **Mật khẩu/OTP/Turnstile:** nhập trên trang Sapo thật. Trang SSO Sapo cấm nhúng iframe; CRM không giả form mật khẩu và không bỏ qua xác minh. Tiện ích chỉ chuyển phiên sau khi đăng nhập, không bảo đảm phiên không bao giờ hết hạn.

## 2. Nhận dữ liệu đẩy

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

## 3. Đẩy đơn hàng / HĐKT sang Sapo – qua n8n → OpenClaw
CRM **không tự tạo đơn trên Sapo**. Đường tạo đơn trực tiếp bằng phiên Sapo (thay "Copy báo giá vào Sapo" của web cũ) đã gỡ ngày 06/11/2026 vì chưa từng chạy thành công trên production. Phiên Sapo và kéo dữ liệu Sapo (mục 1–2) giữ nguyên.

- **Khi nào:** sinh đơn hàng / lập HĐKT (mặc định có tạo đơn Sapo; popup cho chọn "Không tạo đơn trên Sapo"), hoặc nút **Tạo đơn Sapo** trên chứng từ có sẵn.
- **Cách chạy:**
  1. CRM lưu đơn / HĐKT trước.
  2. CRM gửi hook n8n: `crm-order-from-web-to-claw` (đơn hàng) hoặc `crm-hdkt-sapo-order-from-web-to-claw` (HĐKT); POS dùng `crm-pos-order-from-web-to-claw`. `idempotency_key` = `order:<số đơn>` / `hdkt:<số HĐKT>` để n8n không tạo trùng.
  3. OpenClaw tạo đơn nháp trên UI Sapo rồi gọi `POST /integrations/sapo/order-status` (Bearer `SAPO_SYNC_TOKEN`) với `quote_number`, `status: created | created_after_error | existing`, `sapo_order_id`, `sapo_order_code` → CRM lưu liên kết, trang đơn có nút **Đơn Sapo … ↗**.
- **HTTP 2xx từ n8n chỉ nghĩa là n8n đã nhận**, chưa chắc Sapo đã tạo đơn. Báo lỗi từ OpenClaw hiện chưa được CRM lưu (việc tiếp theo).
- **Chặn trước khi gửi:** dòng thiếu SKU, chưa có khách / sản phẩm.
- **Chưa cấu hình n8n** (`env.sapoOrderMode` khác `'n8n'`): báo `SAPO_WEBHOOK_MISSING`, không lưu chứng từ (chọn "Không tạo đơn trên Sapo" để sinh chứng từ). Production luôn bật.
- **Tắt (chỉ cho test):** `env.sapoOrderPush = 'off'`.
- **Code:** `src/modules/sales/api/sapo-push.ts` (gửi n8n), `src/modules/integrations/domain/sapo-order.ts` (dữ liệu + kiểm tra), callback trong `src/modules/sales/api/routes.ts`; giao diện `trial-ui/sapo-push.js`; test `tests/app/sapo-push.test.ts`.

## Chưa làm (đề xuất bước sau)
- Webhook **tồn kho** riêng (`inventory`) và đơn hàng Sapo.
- ~~Nút "Đồng bộ ngay"~~ – đã làm: app tự kéo từ Sapo (`/integrations/sapo/pull`, `/admin/sapo-pull`, lịch chạy `supabase/sapo-cron.sql`), dùng phiên Sapo của Manager lưu mã hoá.

## Tồn kho xoay vòng và chứng từ kho (đơn nhập, điều chuyển, kiểm hàng)

Mỗi lần **Đồng bộ ngay** hoặc chạy theo lịch tự động, ngoài nhân viên, khách hàng mới/đổi và sản phẩm mới/đổi, app còn làm thêm hai việc.

- **Quét tồn kho xoay vòng:**
  - Mỗi lần đọc 6 trang `products.json`, tức 1.500 sản phẩm, không lọc theo ngày sửa, và cập nhật giá cùng tồn. Lần sau đọc tiếp từ trang kế; hết danh mục thì quay lại trang 1.
  - Lý do: bán hàng, nhập hàng hay điều chuyển làm đổi tồn kho nhưng Sapo không đổi ngày sửa của sản phẩm, nên nếu chỉ lọc theo ngày sửa thì tồn sẽ bị cũ.
- **Chứng từ kho**, chỉ đọc từ Sapo (mới/đổi theo `modified_on_min`, tối đa 4 trang mỗi loại mỗi lần):

  | Loại | Đường dẫn Sapo |
  | --- | --- |
  | Đơn nhập hàng | `/admin/purchase_orders.json` |
  | Đơn điều chuyển | `/admin/stock_transfers.json` |
  | Phiếu kiểm hàng | `/admin/stock_adjustments.json` |

  - Dữ liệu lưu vào bảng `sapo_inventory_docs` (đầu phiếu) và `sapo_inventory_doc_lines` (dòng hàng), qua migration `0009`, phân quyền ở `0010`.
  - Bản gốc Sapo được giữ trong cột `data`.
  - Loại nào Sapo không cho đọc (404/403, ví dụ tài khoản thiếu quyền) thì được ghi vào `warnings`; các phần khác vẫn đồng bộ bình thường.

Số báo giá chỉ giữ trong ghi chú nguồn. Trước khi sinh chứng từ, popup chưa có mã đơn Sapo và hiển thị sẽ dùng số đơn/HĐKT mới cấp; không lấy số báo giá làm mã tạm. Mã kiểm trùng, mã tham chiếu và tag đối chiếu dùng số chứng từ đã được cấp trong giao dịch. Các liên kết Sapo đã lưu vẫn giữ nguyên.

### Thao tác Sapo tại danh sách đơn hàng

Cột **Thao tác** trên trang **Đơn đặt hàng** hiển thị **Xem đơn Sapo** khi CRM đã có liên kết; người có quyền tạo đơn thấy **Tạo đơn Sapo** khi chưa liên kết. Đơn đã huỷ không được tạo mới. Nút tạo dùng luồng n8n → OpenClaw hiện có, không ghi trực tiếp vào API Sapo.

Đơn website ML/Lock dùng luồng Claw POS để giữ đúng chi nhánh, thuế và phí. Mã tham chiếu cố định `WEB_ML_<id>` / `WEB_LOCK_<id>` được giữ khi thử lại. CRM kiểm tra SKU, tiền hàng sau giảm giá, VAT, phí và tổng tiền trước khi gửi; thiếu dữ liệu thì báo để kiểm tra, không tự đoán thuế hay trừ giảm giá hai lần. Trạng thái chờ và liên kết được lưu trong bảng `sapo_order_statuses` hiện có; không tạo thêm đơn CRM, chứng từ kho hoặc thu chi.

Khi đang chờ kết quả, nút tạo bị khoá. Callback có mã bí mật tại `/integrations/sapo/order-status` cập nhật liên kết Sapo; CRM chỉ tạo URL từ tên miền Sapo đã cấu hình. Nếu quá thời gian chờ, thao tác đối soát/gửi lại vẫn dùng cùng mã tham chiếu. Nếu nội dung nguồn đã đổi sau lần gửi, cần đối soát trước khi gửi tiếp. Không cần migration cho thay đổi này.
