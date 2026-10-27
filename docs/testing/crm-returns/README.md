# Trả hàng / hoàn tiền cho đơn CRM

PR riêng từ main `4b4dc12`, theo chủ repo cho phép mở rộng API/schema. Không phụ thuộc PR #334.

## Thao tác

Chi tiết đơn/HĐKT CRM có nút **Trả hàng / Hoàn tiền** khi có hàng đã giao. Nhân viên trong phạm vi đơn chọn từng mã, số thực trả, tình trạng và kho nhận; không mặc định trả toàn đơn. Phiếu mới chờ duyệt chưa tác động kho hay tiền.

Manager/người được chỉ định duyệt xác nhận phiếu; người được chỉ định không tự duyệt phiếu của mình. Sau đó nhân viên xác nhận thực nhận đầy đủ đúng các dòng trên phiếu tại kho đã chọn. Hàng đủ điều kiện cộng tồn bán, hàng hỏng chỉ ghi nhận đã trả. Mỗi bước lưu người thực hiện/thời gian và audit. Huỷ/từ chối chỉ trước nhận, có lý do; chứng từ đã nhận không được xoá/huỷ qua luồng này.

Nhận hàng trả làm giảm phải thu qua cơ chế credit có sẵn. Hoàn tiền là bước riêng, chỉ Manager/người được duyệt có quyền Sổ quỹ thực hiện, có xác nhận thực chi/thực chuyển. Chỉ hoàn phần thực thu dư sau đối trừ và không quá giá trị phiếu còn lại; tiền mặt phải có ca két của chính người xác nhận đang mở. Chuyển khoản bắt buộc mã giao dịch, không cần tạo ca POS giả. Chọn két thuộc phạm vi cửa hàng. Nhân viên được lập/nhận hàng không tự có quyền hoàn tiền.

Giữ nguyên đơn, lịch giao, hoá đơn và phiếu thu gốc. Dùng returnAccount/returnAdjustments/netReturnInputs hiện có nên công nợ, sổ thu chi và sổ két đọc cùng chứng từ; chặn sửa/huỷ giá trị đơn hoặc phiếu thu khi có phiếu trả đang hiệu lực. Đơn đã xuất hoá đơn hiện nhắc chuyển kế toán xử lý chứng từ hoá đơn liên quan; không tự sửa/huỷ hoá đơn hay gửi Sapo/GHN.

Ví dụ fixture theo ảnh DH_20261014_002: đơn 4.372.250 đ, đã thu 2.186.125 đ. Trả 2 bộ 09566 giảm nợ 1.600.884 đ, còn phải thu 585.241 đ; trả 2 bộ 22566 giảm nợ 2.771.366 đ, tối đa hoàn 585.241 đ; mỗi mã 1 bộ đối trừ vừa đủ. Đây là **dữ liệu thử local**, không phải ghi nhận trả hàng trên đơn thật.

## API và schema

- GET/POST `/orders/:id/returns`; POST `/orders/:id/returns/:returnId/{approve,cancel,receive,refund,complete}`. Mọi route kiểm phạm vi đơn bằng loadOrder hiện có; POST khoá tiền/đơn/phiếu trong cùng giao dịch. Khóa chống lặp cho lập phiếu/hoàn tiền; nhận kho dùng chính ID phiếu, postMoves chống lặp.
- Dùng chung sổ `pos_returns/pos_return_lines/pos_refunds` hiện có: thêm `source=pos|crm`. POS giữ mặc định pos và DB bắt buộc quầy/ca gốc. Chỉ CRM được để quầy/ca gốc trống, bắt buộc kind=return và after_delivery. Không nới API POS sang CRM; endpoint POS vẫn từ chối phiếu CRM.
- `pos_refunds.shift_id` cho phép null cho chuyển khoản CRM. DB vẫn bắt buộc shift cho tiền mặt, kèm cash_entry. Không tạo bảng tài chính hoặc công thức công nợ thứ hai, không thêm dependency/quyền mới.
- Phân bổ phần làm tròn VNĐ của đơn gốc một lần theo dòng, rồi dùng returnPortion cộng dồn. Trả hết mọi dòng luôn đúng subtotal/tax/total gốc. Từ chối đơn có tổng không khớp dòng thay vì tự sửa tiền.
- Hộp Cần duyệt/việc tự động trỏ phiếu CRM về đơn với `?returns=1`; giữ phạm vi đơn, không mở rộng phạm vi POS. Không thay lịch cron.

## Triển khai sau khi chủ repo duyệt

1. Áp dụng `migrations/postgres/20261027040000_crm_returns.sql` **trước** API/UI mới. Không backfill giả ca/quầy; các bản ghi cũ tự giữ source=pos.
2. Triển khai API và UI cùng phiên bản, kiểm tra thử quyền/ghi nhận trên môi trường thử trước production.
3. Không tự rollback về NOT NULL sau khi có chứng từ CRM; cần xử lý dữ liệu/chứng từ qua migration tiếp theo. Không xoá chứng từ lịch sử để rollback.

Chưa áp migration/deploy production, không ghi trả hàng/hoàn tiền thật. Dừng ở PR chờ chủ repo duyệt.

## Kiểm thử

- Typecheck, build UI, diff check đạt.
- 25 test liên quan đạt: 6 test mới (4 API tích hợp, 2 phân bổ tiền), POS returns/UI và quyền/hộp duyệt hiện có.
- API: quyền phạm vi đơn/NCC, tự duyệt, kho ngoài cửa hàng, đủ lượng đã giao, nhiều lần yêu cầu/huỷ, dòng bị sửa, chưa duyệt/chưa thực nhận, hàng hỏng, request/receive/refund lặp, hai yêu cầu đồng thời không vượt lượng/tiền, tiền mặt cần ca thật, chuyển khoản có audit, công nợ/phiếu thu/hoá đơn gốc, sổ thu chi dùng cùng phiếu hoàn.
- Browser local với router thật/PGlite tại **360/390/430/768/1280px**: nhân viên chọn riêng mã 22566 × 2; Manager duyệt; nhân viên nhận; Manager hoàn 585.241 đ rồi hoàn tất. Kiểm tra trước nút xác nhận chưa ghi kho/tiền; người nhận=emp, người hoàn=mgr, không lỗi JS/tràn modal. [Kết quả](results.json).

[Nhận hàng 390](received-390.png) · [Hoàn tất 390](completed-390.png) · [Hoàn tất 1280](completed-1280.png).
