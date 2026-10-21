# Người nhận hàng riêng khi sinh đơn từ báo giá

Trạng thái: người dùng đã duyệt phương án hai cột và tạo migration. Đã triển khai code và migration `20261021083428_order_delivery_recipient.sql`; chưa áp dụng lên DB CRM live.

## Kết quả đối chiếu

- Form: `trial-ui/index.html` (`#order-create-form`), điều khiển bởi `trial-ui/order-create.js`.
- `POST /orders` trong `src/modules/sales/api/routes.ts` đọc `cleanOrderInput` rồi gọi `createOrderFromQuote`.
- `sales_orders.contact`, `phone` là thông tin người mua/người liên hệ, lấy từ báo giá. Chưa có trường mặc định cho người nhận hàng.
- `deliveries.receiver_name`, `receiver_phone` đã có nhưng chỉ được lưu khi tạo một chuyến giao. Không tạo chuyến giao giả lúc sinh đơn để chứa thông tin này.
- `deliveryPrintData` trong `trial-ui/order-print.js` hiện lấy người nhận từ chuyến giao, thiếu thì dùng người liên hệ của người mua.
- Luồng “Chỉ lên lịch giao” và “Lên lịch & đóng gói” hiện mặc định lấy người liên hệ/SĐT người mua.

## Schema đề nghị: đúng hai cột trên bảng hiện có

| Bảng | Cột SQL | Thuộc tính ứng dụng | Kiểu / mặc định | Ý nghĩa |
| --- | --- | --- | --- | --- |
| sales_orders | receiver_name | receiverName | text NOT NULL DEFAULT '' | Người nhận hàng mặc định của đơn |
| sales_orders | receiver_phone | receiverPhone | text NOT NULL DEFAULT '' | SĐT người nhận hàng mặc định của đơn |

Nội dung migration dự kiến (chỉ là đề xuất trong tài liệu, chưa tạo file migration):

```sql
ALTER TABLE sales_orders
  ADD COLUMN receiver_name text NOT NULL DEFAULT '',
  ADD COLUMN receiver_phone text NOT NULL DEFAULT '';
```

Không thêm bảng, quyền, trạng thái hay cron. Giữ RLS và quyền truy cập bảng hiện tại. Không cập nhật hàng loạt dữ liệu đơn cũ, không thay thông tin khách hàng/báo giá, không đổi tiền hay tồn.

## Hành vi sau khi được duyệt

1. Thêm hai ô “Người nhận hàng”, “SĐT người nhận” cạnh nhau, trước địa chỉ giao hàng trong form sinh đơn. Điền gợi ý từ người liên hệ/SĐT báo giá, cho thay độc lập.
2. `POST /orders` nhận hai chuỗi đã trim, giới hạn tên 500 ký tự, SĐT 100 ký tự, từ chối dữ liệu sai kiểu/quá dài bằng 400. SĐT dùng chuỗi để giữ số 0 đầu và mã quốc gia. Hai trường không bắt buộc để không chặn đơn chưa xác định người nhận.
3. Tạo đơn lưu hai trường riêng; không ghi đè `contact`, `phone` của người mua. Cấu hình API báo hỗ trợ các trường này để UI không gửi vào API cũ rồi mất dữ liệu âm thầm.
4. API chi tiết đơn và dữ liệu in phiếu đóng gói/giao hàng trả hai trường theo quyền sẵn có. Luồng người xem không có quyền mở đơn vẫn chỉ nhận các thông tin giao hàng vốn cần thiết cho kho.
5. Tạo lịch giao mới tự điền người nhận mặc định từ đơn và cho sửa theo chuyến. “Lên lịch & đóng gói” truyền đúng cặp tên/SĐT người nhận; giao về xưởng vẫn giữ thông tin xưởng riêng.
6. Phiếu giao hàng ưu tiên cặp tên/SĐT của chuyến; nếu chuyến chưa có cặp nào, dùng cặp người nhận mặc định của đơn; nếu đơn cũ chưa có cặp nào, dùng cặp người mua như hiện tại. Khi đã có tên người nhận nhưng thiếu SĐT, để trống SĐT, không lấy số người mua ghép nhầm vào tên người nhận.
7. Thông tin người nhận của chuyến giao đã lưu được giữ nguyên; sửa/default của đơn không thay lịch sử chuyến.

Ví dụ: người mua “Anh A · 0901000001”, form đổi người nhận thành “Chị B · 0902000002”. Chi tiết khách hàng vẫn hiện Anh A; lịch giao mới và phiếu giao hàng hiện Chị B cùng 0902000002.

## Kiểm thử dự kiến

- UI điền gợi ý, thay tên/SĐT người nhận độc lập, giữ dữ liệu sau lỗi/hủy chọn kho Sapo, gửi đúng payload.
- API lưu và đọc lại đúng hai trường; người mua không đổi; kiểm kiểu, độ dài và quyền tạo/xem đơn.
- In phiếu ưu tiên chuyến → mặc định đơn → người mua cho đơn cũ; không ghép tên người nhận với SĐT người mua.
- Lịch giao thường và lịch kèm đóng gói dùng đúng thông tin mặc định, cho thay theo chuyến; xưởng không bị đổi.
- Typecheck, test liên quan và Chromium desktop/mobile. Không tự tạo đơn thật hay gọi Sapo live để thử.

## Phạm vi phê duyệt cần thiết

Duyệt phương án hai cột và tạo migration để triển khai code/test. Việc áp dụng migration lên DB CRM live cần được duyệt riêng như các lần trước; tài liệu này chưa yêu cầu chạy DB live.

## Kết quả triển khai

- 50 test liên quan đạt, 0 fail, 0 skip; typecheck và UI build đạt.
- Chromium 1440px và 390px: điền gợi ý từ người mua, sửa người nhận riêng, gửi đúng dữ liệu, phiếu in dùng người nhận riêng. Hai ô Người giao / SĐT người giao sửa trực tiếp được.
- Thay nhãn MST và Thời gian trên phiếu giao theo yêu cầu bổ sung, giữ nguyên mẫu đơn đặt hàng và phiếu đóng gói.
- Chưa kiểm DB live và máy in thật. Cần áp dụng migration trước khi merge vì triển khai main tự động dùng schema mới.

- Bổ sung theo góp ý: phiếu giao đổi “Chủng loại” thành “Tên sản phẩm”; cố định cột tên 24%, ghi chú 18% (xấp xỉ nửa cột tên và gấp đôi cột ghi chú trước đây). Kiểm Chromium và PDF A4 dọc/ngang: chữ nhỏ nhất 11,68px/16,96px.
