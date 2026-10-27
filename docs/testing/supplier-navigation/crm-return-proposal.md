# Trả hàng / hoàn tiền trên đơn CRM — chờ duyệt phạm vi

Yêu cầu: đơn DH_20261014_002 (`c3e3c2d7-55b1-4d8e-9ae2-72463b67d039`) đã giao 4 bộ, khách trả 2 bộ. Thêm thao tác cho nhân viên ghi nhận hàng trả về kho. Chưa ghi nhận trả hàng, nhập kho hoặc hoàn tiền cho đơn thật này.

## Phát hiện từ mã hiện tại

- `trial-ui/app.js`: chỉ tạo nút Trả / Đổi / Hoàn tiền khi `channel === 'pos'` và có `pos.sell`.
- `src/modules/sales/api/pos-return-routes.ts`: nguồn trả bắt buộc đơn POS có `shiftId`; cả lập, nhận hàng và hoàn tiền kiểm tra ca/quầy/két POS. Không thể chỉ bật nút này cho CRM.
- `src/modules/sales/return-schema.ts`: `pos_returns.register_id`, `created_shift_id` và `pos_refunds.shift_id` là NOT NULL, liên kết dữ liệu POS. Đơn CRM không có ca/quầy tương ứng. Không tạo ca/quầy giả để vượt kiểm tra.
- Đối trừ công nợ đã có `returnAccount`, `returnAdjustments`, `netReturnInputs`; phân bổ số tiền trả có `returnPortion` để giữ cách làm tròn hiện tại. Có thể dùng lại các hàm này khi thiết kế chứng từ trả CRM.

## Luồng đề xuất để duyệt

1. Chi tiết đơn có nút **Trả hàng / Hoàn tiền** hiển thị trực tiếp. Form liệt kê mã, tên, đã giao, đã trả, còn được trả; nhân viên chọn dòng và số lượng thực trả. Không mặc định trả cả đơn.
2. Chọn kho nhận thực tế, tình trạng hàng (nhập lại tồn bán / hàng hỏng), lý do. Xem trước giá trị hàng trả và công nợ/tiền có thể hoàn theo số thực thu. Giữ nguyên chứng từ bán và hoá đơn gốc; ghi liên kết chứng từ trả.
3. Nhân viên gửi yêu cầu; Manager/người được duyệt xử lý theo cơ chế duyệt hiện có. Quyền xem/ghi vẫn kiểm tra phạm vi đơn. Không tự cấp quyền POS cho nhân viên CRM.
4. Bước **Đã nhận hàng trả** có xác nhận, ghi đúng kho và số thực nhận, lưu người nhận/thời gian; mỗi lần ghi sổ có khoá chống lặp. Không nhận vượt số đã giao trừ số đã trả/đang giữ trong phiếu khác.
5. Sau khi nhận, giảm công nợ tương ứng. Chỉ cho hoàn phần thực thu dư sau đối trừ; hoàn tiền là bước riêng, chọn tiền mặt/chuyển khoản, tham chiếu và người xác nhận. Không tự gửi Sapo/GHN hoặc sửa hoá đơn đã phát hành.
6. Hiện lịch sử phiếu trả, nhận kho và hoàn tiền ngay trên đơn. Huỷ/từ chối trước nhận giải phóng lượng đang giữ; sau nhận dùng chứng từ đảo được kiểm tra, không xoá lịch sử.

## Ví dụ theo ảnh của đơn, để tránh hoàn tiền sai

Đơn gốc 4.372.250 đ, đã thu 2.186.125 đ; mỗi mã có 2 bộ. Đây là minh hoạ từ ảnh, không phải bút toán đã thực hiện.

| Khách trả | Giá trị trả gồm VAT theo ảnh | Kết quả đối trừ dự kiến |
|---|---:|---|
| 2 bộ mã 09566 | 1.600.884 đ | Còn phải thu 585.241 đ, chưa có tiền dư để hoàn |
| 2 bộ mã 22566 | 2.771.366 đ | Dư đã thu 585.241 đ, tối đa số này được hoàn |
| Mỗi mã 1 bộ | 2.186.125 đ | Hết công nợ, không phát sinh tiền hoàn |

Khi triển khai, số tiền phải lấy từ dữ liệu dòng gốc trên server và cách làm tròn hiện có, không lấy các con số minh hoạ này làm hằng số.

## Phần cần mở rộng, chưa triển khai

Cần API/chứng từ lưu trả CRM độc lập ca POS, migration để lưu đúng nguồn CRM (hoặc bảng riêng), và xác định thao tác nhận/hoàn theo quyền hiện có. Kiểm thử bắt buộc: trả một phần/nhiều lần, trả đồng thời chống vượt, gửi lặp không nhập kho/hoàn tiền lần hai, sai phạm vi đơn/kho/két, hàng hỏng, đối trừ công nợ và đơn đã xuất hoá đơn.

Chưa thay schema/API/quyền vì yêu cầu giới hạn trước đó ghi: **“Dừng nếu cần đổi API, schema, quyền hoặc thêm dependency lớn.”** Bản này làm rõ thay đổi để chủ repo duyệt mở phạm vi trước khi triển khai.
