# Manager huỷ nhanh POS khi GHN đã huỷ/hoàn thành công

Trong chi tiết đơn POS COD, Manager dùng nút **Huỷ phiếu nhanh**. API kiểm tra trực tiếp từng vận đơn trên đúng tài khoản GHN: chỉ chấp nhận `cancel` hoặc `returned`. Không tin trạng thái lưu đệm hoặc trạng thái do trình duyệt gửi. Nhân viên vẫn dùng quy trình thu hồi, duyệt, nhận hoàn và hoàn tiền hiện có.

Một lần xác nhận thực hiện trong cùng transaction:

- Tạo chứng từ hoàn/giảm trừ để xoá phần phải thu, huỷ đơn và các chuyến, bỏ giữ hàng và huỷ các yêu cầu thu tiền POS còn chờ.
- Đảo đúng bút toán xuất còn lại của đơn/chuyến/đóng gói ở kho gốc. Chưa xuất thì không tự cộng tồn. Không xoá lịch sử kho hoặc phiếu thu.
- Đã thu tiền thì chỉ ghi hoàn **số thực thu**; ví dụ cọc 50.000đ của đơn 194.400đ chỉ hoàn 50.000đ. Manager chọn cách đã hoàn và xác nhận thực tế ngay trong hộp huỷ; tiền mặt ghi khoản chi đúng ca/két, chuyển khoản cần mã giao dịch. Chưa thu thì không cần ca mở hay chứng từ hoàn tiền.
- Chứng từ trả/nhận hàng/hoàn tiền được lập tự động, không cần bấm từng bước riêng. Không gửi chuyển tiền ngân hàng hay lệnh huỷ GHN/Sapo; Sapo vẫn xử lý thủ công.

Giữ chặn với đơn đã giao thành công, hoá đơn đã xuất, phiếu đổi/trả/hoàn hiện có, nguồn kho không khớp hoặc lần sửa GHN đang chờ. `returning`, `return_fail`, giao thất bại, mất/hỏng hàng chưa đủ điều kiện. Các trường hợp đã có chứng từ dùng tiếp chứng từ đó để không ghi trùng.

GET/POST: `/pos/orders/:id/ghn-quick-cancel`. Chỉ Manager được gọi cả hai endpoint. Đọc GHN ngoài khoá kho/tiền; trước commit khoá lại và kiểm tra revision, chuyến và tiền. Một key gắn actor/nội dung; gửi lặp/concurrent không ghi thêm. Callback GHN đến muộn không xuất kho hoặc thu COD lại sau huỷ.

Không migration, không secret mới, không thay luồng huỷ nhanh bill tại quầy hay quy trình nhân viên. Không sửa đơn thật trong kiểm tra.

## Xác minh

- 6 ca `pos-ghn-quick-cancel`: quyền, bỏ giữ, đúng tồn/tiền, concurrent/replay, trạng thái thực tế GHN, rollback lỗi hoàn tiền, invoice/recall, thay đổi giữa lúc đọc GHN và chặn lần sửa sản phẩm còn chờ — qua.
- 4 ca huỷ nhanh tại quầy và 6 ca đồng bộ GHN cũ — qua. 5 ca markup/UI — qua.
- Typecheck và diff check — qua.
- `scripts/testing/manager-ghn-quick-cancel.mjs`: Chromium thực + router/PGlite, GHN giả lập; máy tính huỷ chưa xuất/chưa thu, điện thoại hoàn hàng đã xuất/cọc 50.000đ. Giả lập mất phản hồi sau commit rồi gửi lại đúng nội dung: một phiếu, không hoàn lần hai. Không gọi CRM/GHN/Sapo thật.

[Kết quả](results.json) · [Máy tính](confirm-1280.png) · [Điện thoại](confirm-390.png)
