# Trang khách hàng (`customer.html`)

Mỗi khách hàng có tài khoản đăng nhập riêng và chiết khấu riêng theo nhãn hàng. Khách dùng trang này để:
- xem báo giá công ty gửi;
- tự tạo yêu cầu báo giá;
- đặt hàng (tạo đơn mua hàng) và xác nhận đặt hàng từ báo giá đã duyệt;
- theo dõi đơn hàng, lịch giao và số tiền còn phải trả.

Khách **chỉ** vào được trang này. Khách **không** thấy tồn kho, giá nhập, chi phí in gia công hay ghi chú nội bộ.

## Tài khoản
- Tài khoản khách là một `staff_members` có vai trò `customer` (chức vụ `customer`). Đăng nhập, kích hoạt và phiên dùng chung cơ chế với nhân viên.
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
1. **Khách gửi yêu cầu báo giá** → báo giá `B2B_BG…` ở trạng thái *Chờ duyệt*, giao cho nhân viên phụ trách. Trong danh sách báo giá của nhân viên, báo giá này có nhãn *Khách gửi*.
2. **Nhân viên phụ trách** (hoặc Manager) bấm **Xác nhận báo giá khách** → báo giá thành *Đã duyệt*.
   - Nhân viên chỉ duyệt được báo giá do khách gửi; báo giá thường vẫn chỉ Manager duyệt.
3. **Khách bấm "Xác nhận đặt hàng"** trên báo giá đã duyệt → đơn đặt hàng *Chờ xác nhận* (`sales_orders.status = draft`).
4. **Nhân viên bấm "Xác nhận đơn"** trên trang đơn → *Đã xác nhận*. Từ đây đơn đi tiếp như thường: HĐKT, giao hàng, công nợ.
5. **Đặt hàng ngay** (từ danh mục, không qua bước báo giá): tạo cùng lúc báo giá chờ duyệt và đơn *Chờ xác nhận*. Nhân viên xác nhận đơn thì báo giá của đơn cũng được duyệt luôn.

Khách huỷ được đơn khi đơn chưa được xác nhận. Báo giá nhân viên lập cho khách chỉ hiện với khách khi đã được duyệt.

## API
Các API trang khách hàng, khu vực `customer-portal`:

| Route | Việc |
| --- | --- |
| `GET /portal/me` | Khách hàng, chiết khấu riêng, nhân viên phụ trách |
| `GET /portal/catalog?v=` | Danh mục: giá bán lẻ và % chiết khấu theo nhãn, **không có tồn kho** |
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

- **Bật thông báo:** chuông thông báo trên đầu trang → **Bật thông báo trên máy này**.
  - Trình duyệt đăng ký nhận qua service worker `push-sw.js`; app lưu đăng ký vào `staff_web_push_subscriptions`.
  - Trên iPhone, phải thêm trang vào Màn hình chính trước thì mới bật được.
- **Nội dung thông báo được mã hoá gửi kèm** (RFC 8291 `aes128gcm`, VAPID RFC 8292).
  - Web cũ gửi push rỗng rồi service worker tự gọi API bằng cookie. Web mới đăng nhập bằng mã phiên trong tab nên service worker không tự gọi được.
  - **Khoá VAPID máy chủ tự sinh lần đầu**, lưu ở bảng `web_push_keys`, khoá riêng được mã hoá bằng `SAPO_SYNC_TOKEN`. Không cần cài thêm mã bí mật.
- **Trang tự làm mới:**
  - Nhận push thì service worker báo cho các tab đang mở. Ngoài ra trang tự kiểm tra `/notifications?since=` mỗi 30 giây và mỗi lần quay lại tab.
  - Khi có thông báo mới, trang hiện thông báo nhỏ và tải lại dữ liệu đang xem: danh sách báo giá, đơn đang mở, trang Khách hỏi tồn… Báo giá đang sửa dở thì không bị tải đè.
- **Khách hỏi tồn kho** (bảng `customer_stock_requests`, migration `0013`, phân quyền ở `0014`):
  - Khách chọn sản phẩm rồi bấm *Hỏi tồn kho*.
  - Nhân viên mở trang **Khách hỏi tồn**: xem tồn khả dụng, NCC và hàng chờ về; nhập số đáp ứng được và lời nhắn.
  - Khách nhận thông báo và xem câu trả lời ở thẻ *Hỏi tồn kho*.
- **API:**
  - Khu vực `self`: `/push/config`, `/push/subscribe`, `/push/unsubscribe`, `/notifications`, `/notifications/read`.
  - Khu vực `customer-portal`: `/portal/stock-requests`.
  - Khu vực `business`: `/stock-requests`, `/stock-requests/:id/answer`.
