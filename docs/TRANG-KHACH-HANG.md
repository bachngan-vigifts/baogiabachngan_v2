# Trang khách hàng (`customer.html`)

Mỗi khách hàng có tài khoản đăng nhập riêng và chiết khấu riêng theo nhãn hàng. Khách dùng trang này để:
- xem báo giá công ty gửi;
- tự tạo yêu cầu báo giá;
- đặt hàng (tạo đơn mua hàng) và xác nhận đặt hàng từ báo giá đã duyệt;
- theo dõi đơn hàng, lịch giao và số tiền còn phải trả.

Khách **chỉ** vào được trang này. Khách **không** thấy tồn kho, giá nhập, chi phí in gia công hay ghi chú nội bộ.

## Tài khoản
- Tài khoản khách là một `staff_members` có vai trò `customer` (chức vụ `customer`). Đăng nhập, kích hoạt và phiên dùng chung cơ chế với nhân viên.
- **Đăng nhập bằng email hoặc số điện thoại** (`staff/domain/login-id.ts`):
  - Ô đăng nhập nhận cả hai. Có "@" thì là email; còn lại đọc như số điện thoại và chuẩn hoá về `0xxxxxxxxx` (bỏ dấu cách, chấm, gạch; `+84` / `84` thành `0`).
  - Chỉ tài khoản khách hàng đăng nhập được bằng số. Nhân viên vẫn dùng email.
  - Số điện thoại của tài khoản khách không được trùng với tài khoản khách khác (409). Số không đọc được vẫn lưu nguyên nhưng không dùng để đăng nhập.
  - Nhân viên đặt số khi cấp tài khoản, hoặc bấm **Thêm SĐT / Đổi SĐT** trong hộp Tài khoản (`PUT /customer-accounts/:id { phone }`).
  - Liên kết đặt mật khẩu vẫn gửi theo email.
- Bảng `customer_accounts` gắn tài khoản với khách hàng Sapo, nhân viên phụ trách và chiết khấu riêng.
  - Migration `0011_customer_accounts.sql` tạo bảng này và thêm chức vụ "Khách hàng".
  - Migration `0012_supabase_access_customer_accounts.sql` thu hồi quyền truy cập trực tiếp của `anon` và `authenticated`.
- **Khu vực quyền `customer-portal`:**
  - Tài khoản khách chỉ gọi được `self` (đăng xuất, đổi mật khẩu) và `customer-portal`.
  - Nhân viên và Manager không gọi được `customer-portal`.
- **Cấp tài khoản:** trang Khách hàng → nút **Tài khoản**.
  - Nhân viên cấp được cho khách. Người phụ trách là chính nhân viên đó, và nhân viên không được đặt chiết khấu.
  - Manager chọn được người phụ trách và đặt **chiết khấu riêng theo nhãn**: Minh Long, Minh Long - Lys, Lock&Lock (giống ô chiết khấu khách hàng của web cũ, hàm `customerDiscount`).
  - App trả một link đặt mật khẩu hiệu lực 15 phút để gửi cho khách. Có nút cấp lại link và nút khoá/mở khoá tài khoản.
- Tài khoản khách không hiện trong trang Nhân viên và không đổi được thành nhân viên ở trang đó.

## Giá
Giá khách thấy = giá **"Giá bán lẻ"** − chiết khấu riêng theo nhãn hàng, chưa VAT.
- Giá được tính lại ở máy chủ khi khách gửi; giá từ trình duyệt không được dùng.
- Sản phẩm chưa có giá bán lẻ thì không đặt được.

## Luồng

Thẻ trên trang khách (theo thứ tự): **Tạo báo giá / Check tồn** (mặc định) · **Danh sách báo giá / Check tồn** · **Đơn đặt hàng / HĐKT** · **Công nợ**.
1. **Khách gửi yêu cầu báo giá** → báo giá `B2B_BG…` ở trạng thái *Chờ duyệt*, giao cho nhân viên phụ trách. Trong danh sách báo giá của nhân viên, báo giá này có nhãn *Khách gửi*.
2. **Nhân viên phụ trách** (hoặc Manager) bấm **Xác nhận báo giá khách** → báo giá thành *Đã duyệt*.
   - Nhân viên chỉ duyệt được báo giá do khách gửi; báo giá thường vẫn chỉ Manager duyệt.
3. **Khách bấm "Xác nhận đặt hàng"** trên báo giá đã duyệt → đơn đặt hàng *Chờ xác nhận* (`sales_orders.status = draft`).
4. **Nhân viên bấm "Xác nhận đơn"** trên trang đơn → *Đã xác nhận*. Từ đây đơn đi tiếp như thường: HĐKT, giao hàng, công nợ.
   - **Công nợ** (thẻ *Công nợ* của khách và trang *Công nợ* của nhân viên) chỉ tính đơn đã xác nhận hoặc đơn có HĐKT đã ký; đơn đang chờ xác nhận chưa phát sinh công nợ.
5. **Đặt hàng ngay** (từ danh mục, không qua bước báo giá): tạo cùng lúc báo giá chờ duyệt và đơn *Chờ xác nhận*. Nhân viên xác nhận đơn thì báo giá của đơn cũng được duyệt luôn.
6. **Bước xác thực**:
   - Mọi cách khách gửi đơn (đặt hàng ngay, đặt theo báo giá, đặt từ đơn check tồn) đều mở hộp xác nhận: thông tin công ty, MST, người nhận, địa chỉ giao, sản phẩm, tổng tiền, ngày giao mong muốn. Khách phải đánh dấu đủ các mục. Máy chủ từ chối đơn thiếu `confirmed: true` (`CONFIRM_REQUIRED`).
   - Nhân viên bấm *Xác nhận đơn* cũng phải đánh dấu đủ 5 mục: thông tin khách, sản phẩm/giá, tồn kho, ngày giao, điều kiện thanh toán. Máy chủ yêu cầu `verified: true` (`VERIFY_REQUIRED`).
7. **Ngày giao dự kiến**:
   - Trang đơn của nhân viên tô màu theo hạn: trễ hoặc hôm nay đỏ, ≤ 3 ngày cam, ≤ 7 ngày xanh dương, xa hơn xanh lá.
   - Ô *Lịch giao hàng* có ô chọn ngày giao dự kiến (`PUT /orders/:id/delivery-date`). Lên lịch giao một ngày khác cũng đổi ngày dự kiến theo.
   - Đơn do khách đặt thì khách thấy ngày mới ở thẻ *Đơn đặt hàng / HĐKT* và nhận thông báo (`order_delivery_date`).

Khách huỷ được đơn khi đơn chưa được xác nhận. Báo giá nhân viên lập cho khách chỉ hiện với khách khi đã được duyệt.

## API
Các API trang khách hàng, khu vực `customer-portal`:

| Route | Việc |
| --- | --- |
| `GET /portal/me` | Khách hàng, chiết khấu riêng, nhân viên phụ trách |
| `GET /portal/catalog?v=` | Danh mục: **chỉ thương hiệu Minh Long, Minh Long I, Minh Long - LYS, LYS, Lock&Lock, Healthy Cook (Sứ dưỡng sinh)** (thương hiệu khác bị chặn cả khi tạo báo giá / đặt hàng / check tồn); giá bán lẻ và % chiết khấu theo nhãn, **không có tồn kho** |
| `GET /portal/quotes` · `GET /portal/quotes/:id` | Báo giá của khách, đã bỏ các trường nội bộ |
| `POST /portal/quotes {items:[{sku,qty}], note, deliveryDate, order?}` | Yêu cầu báo giá; `order: true` là đặt hàng ngay |
| `POST /portal/quotes/:id/order` | Xác nhận đặt hàng từ báo giá đã duyệt |
| `GET /portal/orders` · `POST /portal/orders/:id/cancel` | Đơn của khách: dòng hàng, lịch giao, còn phải trả; huỷ đơn chưa xác nhận |

Các API phía nhân viên, khu vực `business`:

| Route | Việc |
| --- | --- |
| `GET /customers/:id/accounts` | Danh sách tài khoản của một khách |
| `POST /customer-accounts` | Cấp tài khoản |
| `PUT /customer-accounts/:memberId {discounts?, ownerId?, active?}` | Đổi chiết khấu, người phụ trách, khoá/mở khoá |
| `POST /customer-accounts/:memberId/reset` | Cấp lại link đặt mật khẩu |

Thay đổi ở API sẵn có:
- `PUT /orders/:id/status {confirmed}` chỉ áp dụng cho đơn *Chờ xác nhận*.
- `POST /quotes/:id/approve` cho phép nhân viên phụ trách duyệt báo giá do khách gửi.
- `GET /quotes` trả thêm `fromCustomer`; `GET /quotes/:id` trả thêm `fromCustomer` và `canApprove`.

## Thông báo (Web Push như web cũ) và trang tự làm mới
Các sự kiện được thông báo:

| Sự kiện | Ai nhận |
| --- | --- |
| Khách gửi yêu cầu báo giá (`customer_quote`) | Nhân viên phụ trách |
| Khách đặt hàng hoặc xác nhận đặt hàng (`customer_order`) | Nhân viên phụ trách |
| Khách hỏi tồn kho (`customer_stock_request`) | Nhân viên phụ trách |
| Nhân viên xác nhận báo giá (`quote_confirmed`), xác nhận hoặc huỷ đơn (`order_confirmed` / `order_cancelled`), trả lời tồn kho (`stock_answer`) | Khách |

- **Tự bật thông báo** (`trial-ui/notify.js`, không cần vào chuông):
  - Đã cho phép trên máy này: mỗi lần mở trang tự đăng ký lại và lưu lên máy chủ (máy mới, đăng ký hết hạn đều tự khắc phục).
  - Chưa hỏi quyền: lần chạm hoặc bấm đầu tiên trên trang sẽ hiện hộp "Cho phép thông báo" của trình duyệt. Trình duyệt chỉ cho hỏi khi người dùng có thao tác. Từ chối hoặc bỏ qua thì 3 ngày sau mới hỏi lại.
  - iPhone mở bằng Safari thường (không hỗ trợ push): hiện thanh nhắc "Chia sẻ → Thêm vào MH chính". Đóng thanh thì 7 ngày sau mới nhắc lại.
  - Đã chặn thông báo thì web không tự mở lại được; người dùng phải cho phép trong cài đặt trình duyệt.
- **Âm báo, rung, số trên icon app** (`trial-ui/alert.js`):
  - **App đang mở:** có thông báo mới hoặc tin nhắn mới thì phát tiếng "ting–ting" riêng của Bách Ngân và rung (Android). Tiếng được tạo bằng Web Audio, không cần file âm thanh.
    - Bật / tắt bằng nút **🔔 Âm báo & rung** trong chuông. Lựa chọn lưu ở `localStorage` `bn-sound`.
    - Trình duyệt chỉ cho phát tiếng sau lần chạm / bấm đầu tiên trên trang.
  - **App đang đóng:** thông báo đẩy dùng âm thanh mặc định của máy. Web không chọn được tiếng chuông riêng; Android đổi được trong cài đặt thông báo của trình duyệt / app.
  - **Số đỏ trên icon app:** tổng thông báo chưa đọc và tin nhắn chưa đọc (`navigator.setAppBadge`).
    - iPhone hỗ trợ từ iOS 16.4 khi đã thêm vào màn hình chính; Android và máy tính hỗ trợ khi đã cài app.
    - Service worker lưu con số trong IndexedDB và cộng thêm 1 mỗi lần nhận thông báo đẩy lúc app đóng. Mở app thì số được đặt lại đúng theo máy chủ.
- **Bật thông báo thủ công (dự phòng):** chuông thông báo trên đầu trang → **Bật thông báo trên máy này**.
  - Trình duyệt đăng ký nhận qua service worker `push-sw.js`; app lưu đăng ký vào `staff_web_push_subscriptions`.
  - Trên iPhone, phải thêm trang vào Màn hình chính trước thì mới bật được.
- **Gửi thông báo thử:** đã bật rồi thì chuông có thêm nút **Gửi thông báo thử** (`POST /push/test`).
  - Máy chủ gửi push "Thông báo thử" tới mọi thiết bị đã bật của chính tài khoản đó. Thông báo này không lưu vào chuông.
  - Trang báo đã gửi tới bao nhiêu trên bao nhiêu thiết bị. Gửi được 0 thiết bị thì hiện lại nút **Bật thông báo trên máy này**.
- **Nội dung thông báo được mã hoá gửi kèm** (RFC 8291 `aes128gcm`, VAPID RFC 8292).
  - Web cũ gửi push rỗng rồi service worker tự gọi API bằng cookie. Web mới đăng nhập bằng mã phiên trong tab nên service worker không tự gọi được.
  - **Khoá VAPID máy chủ tự sinh lần đầu**, lưu ở bảng `web_push_keys`, khoá riêng được mã hoá bằng `SAPO_SYNC_TOKEN`. Không cần cài thêm mã bí mật.
- **Trang tự làm mới:**
  - Nhận push thì service worker báo cho các tab đang mở. Ngoài ra trang tự kiểm tra `/notifications?since=` mỗi 30 giây và mỗi lần quay lại tab.
  - Khi có thông báo mới, trang hiện thông báo nhỏ và tải lại dữ liệu đang xem: danh sách báo giá, đơn đang mở, trang Khách hỏi tồn… Báo giá đang sửa dở thì không bị tải đè.
- **Đơn check tồn** (bảng `customer_stock_requests`, migration `0013`, phân quyền ở `0014`):
  - Khách chọn sản phẩm rồi bấm *Gửi check tồn* (cạnh nút *＋ Thêm sản phẩm*).
  - Nhân viên mở trang **Khách hỏi tồn**: xem tồn khả dụng, NCC và hàng chờ về; nhập số đáp ứng được và lời nhắn.
  - Khách nhận thông báo và xem câu trả lời ở thẻ *Danh sách báo giá / Check tồn* (phần Đơn check tồn).
- **API:**
  - Khu vực `self`: `/push/config`, `/push/subscribe`, `/push/unsubscribe`, `/notifications`, `/notifications/read`.
  - Khu vực `customer-portal`: `/portal/stock-requests`.
  - Khu vực `business`: `/stock-requests`, `/stock-requests/:id/answer`.

## Khách không có email: đăng nhập bằng số di động
- Khi tạo tài khoản khách, **email không bắt buộc** nếu có số di động hợp lệ. Gõ số điện thoại vào ô email cũng được hiểu là số di động.
- Tài khoản chỉ có số di động:
  - cột email (bắt buộc, duy nhất) giữ một địa chỉ nội bộ `kh-…@sdt.invalid`, không bao giờ hiện ra giao diện;
  - link đặt mật khẩu ghi số di động;
  - khách đăng nhập bằng số di động ở mọi dạng viết (0931 328 616, +84…);
  - không bỏ được số di động của tài khoản này (khách sẽ mất cách vào).

## Thanh chức năng và Doanh số
- Thanh chức năng trang khách nổi bật: nút to có biểu tượng, nút đang chọn màu đỏ, thanh dính trên đầu khi cuộn.
- Thẻ **📈 Doanh số** (tính ở trình duyệt từ `/portal/orders`):
  - tổng mua theo năm (gồm VAT), số đơn, so với năm trước;
  - từng tháng (thanh ngang), 15 sản phẩm mua nhiều nhất;
  - chỉ tính đơn đã xác nhận / đang giao / đã giao.
