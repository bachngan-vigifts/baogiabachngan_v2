# Tách phần chưa nhận và bỏ huỷ trên danh sách

## Hành vi

- Bỏ nút huỷ/xoá khỏi danh sách ngoài; chỉ thao tác khi đã mở chi tiết từng phiếu NCC.
- Cho Manager tách phiếu gốc có nhóm đã nhận và nhóm chưa nhận, hoặc bấm huỷ trực tiếp nhóm chưa nhận. Giữ nhóm đã nhận trên ID gốc và giữ nguyên ID dòng/phân bổ nhận hàng. Chỉ chuyển các phân bổ chưa nhận sang phiếu con; cập nhật số lượng và nguồn của phiếu gốc, xoá dòng rỗng. Không nhân đôi yêu cầu.
- Link phiếu gốc tiếp tục mở nhóm đã nhận và các phiếu con còn hoạt động. Tách/gọi lại không tạo thêm phiếu. Nguồn cũ khi gửi lại lệnh huỷ được tìm đúng phiếu con.
- Phiếu NCC có nhận hàng đang hiệu lực vẫn bị chặn huỷ. Nếu chứng từ nhận ghi nhầm đã được huỷ qua luồng hiện có (đã đảo tồn), phiếu xin mới được giải phóng; huỷ phiếu xin không đảo tồn lần hai. Lịch sử cũ không tìm được chứng từ nhận vẫn được bảo vệ.
- Trùng SKU giữa các yêu cầu/đơn mua không cộng nhầm số đã nhận. Số đã nhận riêng từng phiếu và số đã nhận qua phiếu khác được tách rõ. Giữ giới hạn tổng nhận của dòng đơn mua; hiển thị lý do khi nguồn đã nhận đủ ở phiếu khác, kèm hướng dẫn mở đơn mua để đối soát.
- Không thay schema, quyền, tiền, nghiệp vụ nhập kho, Sapo/GHN hay cron.

## Kiểm thử cục bộ

Typecheck, build UI, diff check đạt. **20 test đạt**: 4 test mới về tách một phần/nhận cùng SKU/đảo nhận nhầm; 5 delete-split; 5 receiving; 4 Manager UI; 1 danh sách; 1 lịch kho.

Test mới dùng router thật/PGlite, chứng từ nhận và ledger trong fixture:

- Sau nhận một phần, tách đúng phần chưa nhận; nhận tiếp vẫn đúng số lượng, ID gốc và chứng từ cũ; kho/phiếu nhận/sự kiện nhận không đổi.
- Huỷ trực tiếp nhóm chưa nhận, bảo vệ nhóm đã nhận, gọi lại an toàn, không cho nhận theo phiếu đã huỷ.
- Cùng SKU khác đơn vẫn nhận độc lập. Cùng dòng đơn mua giữ số đã nhận riêng từng yêu cầu, chỉ chặn khi tổng đơn mua đã nhận đủ; trả rõ purchaseRemaining/receivedElsewhere.
- Huỷ phiếu nhận ghi nhầm bằng API hiện có, sau đó huỷ phiếu xin không tạo thêm đảo tồn.

Browser early-partial-split.mjs đạt ở 390/1280px: nhận hàng trong fixture, tách hai nhóm chưa nhận, huỷ lần lượt hai nhóm và giữ nguyên nhóm/ID đã nhận; không đổi ledger hoặc nhân đôi số đã nhận; hiển thị nguồn nhận ở phiếu khác; không lỗi JS. Browser early-list-actions.mjs đạt: danh sách không có nút huỷ/xoá ở 390/1280px, chi tiết vẫn có nút từng phiếu; không ghi dữ liệu khi mở danh sách.

Ảnh và results.json trong thư mục này chỉ dùng dữ liệu fixture cục bộ. PR không tự sửa hoặc huỷ chứng từ trên hệ thống thật. Với nguồn đã bị ghi nhận đủ, cần đối soát chứng từ nhận trước khi nhận lại; tách phiếu không bỏ giới hạn tổng số lượng của đơn mua.
