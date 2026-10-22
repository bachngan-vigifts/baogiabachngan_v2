# Sổ quỹ theo két quầy

Trang `#/cash` dùng cùng ca với POS. `#/cashbook` vẫn là sổ thu khách/chi NCC để đối soát, có cả chuyển khoản; hai báo cáo phục vụ mục đích khác nhau.

## Kết quả đọc production trước triển khai

Ngày 18/10/2026: `work_cash_requests` 0 dòng, `work_shifts` 0 dòng, `customer_payments` 19 dòng, `supplier_payments` 0 dòng. Chưa có ca POS trên production. Bảng `customer_payments` còn thiếu các cột huỷ của 0071. Chỉ thực hiện SELECT; chưa chạy migration hay ghi dữ liệu production. Không tự cộng 19 phiếu lịch sử vào số đầu kỳ.

## Triển khai

Kiểm tra migration nền của main, đặc biệt `0071_accounting_tools.sql`, rồi chạy theo thứ tự, trước khi đưa API/UI mới lên:

1. `20261018093740_pos_sales.sql`
2. `20261018093741_supabase_access_pos.sql`
3. `20261018122409_cash_drawer.sql`
4. `20261018122409_supabase_access_cash_drawer.sql`

Schema POS thêm ca/giỏ/thu tiền; schema Sổ quỹ thêm `cash_drawers`, `cash_entries`, `cash_reconciliations`, liên kết két vào quầy và ca. RLS bật, quyền trực tiếp PUBLIC/anon/authenticated bị thu hồi. API kiểm quyền bằng vai trò/quyền CRM, không dùng token phía client. Migration sinh bằng Drizzle; tên migration Sổ quỹ được tạo bằng Supabase CLI. Các migration này đã được chạy trên production ngày 18/10/2026.

Manager cấu hình quầy (kho thật đã chốt đầu kỳ, đúng hai bảng giá) tại POS và nhập **số dư két đầu kỳ kèm lý do một lần** tại Sổ quỹ. Ngưỡng duyệt mặc định 1.000.000 VNĐ nằm trong cấu hình két, Manager thay đổi được. Sau khi vận hành, sửa số dư bằng phiếu điều chỉnh; không sửa ngược đầu kỳ.

## Tách két Lock / Minh Long

Không thêm bảng hoặc cột: dùng `cash_drawers` và `pos_registers.cash_drawer_id` sẵn có. Manager mở Sổ quỹ → **+ Két riêng cho quầy**, chọn Quầy Lock, đặt tên Két Lock; làm tương tự cho Quầy Minh Long. Cả hai két mới chưa có tiền đầu kỳ. Chọn từng két → **Cấu hình két** để nhập tiền thực tế kèm lý do. Không sao chép khoản 1.000.000đ đã nhập ở két chung cũ: cấu hình cũ vẫn được lưu, không tính vào hai két mới. Két cũ không gắn quầy và chưa có ca không nằm trong danh sách két hoạt động.

Chỉ tách quầy chưa từng có ca; nếu đã có lịch sử thì API từ chối để giữ nguyên liên kết bàn giao/phiếu. Tạo két có mã chống lặp, kiểm quyền Manager và nhật ký trong cùng transaction. Nhân viên được xem phiếu/ca của mình trong két đang chọn; Manager/Kế toán xem các két. Danh sách phiếu, ca, tra soát và số dư đều lọc ở server theo két. POS lấy đầu ca từ két gắn quầy, cập nhật khi đổi quầy trong form. Thu lại phiếu POS phải ở đúng két gốc của đơn; COD tiếp tục qua chuyến giao đúng két, không thu chéo.

## Thao tác hằng ngày

1. Mở ca ở POS; không còn bước kiểm đếm nhanh tồn. Tiền bàn giao tham chiếu lấy số thực đếm ca trước, ca đầu lấy số dư Manager chốt. Nhân viên nhập tiền thực đếm mới; lệch tự mở tra soát nhưng vẫn mở ca bán. Số thực đếm mới là tiền đầu ca dùng trong công thức kết ca. Mỗi két chỉ có một ca giữ két đang mở. Lock và Minh Long dùng hai két riêng nên có thể mở ca đồng thời với hai nhân viên khác nhau.
2. Tiền mặt bán hàng và COD thực nhận được ghi theo ca đang mở. Chuyển khoản không vào két. COD chưa nhận không vào két và được theo dõi sang ca sau.
3. **Thu tiền** gồm Thu khác/Rút két; **Chi tiền** gồm Chi vặt/Tạm ứng/Nộp két. Số tiền nguyên VNĐ > 0, nội dung bắt buộc, một ảnh hoá đơn tuỳ chọn. Chỉ nhân viên đang giữ ca tạo phiếu thường; Manager tạo phiếu điều chỉnh cho két đang mở, có thể tham chiếu tra soát.
4. Số tiền từ ngưỡng cấu hình trở lên ở trạng thái **Chờ duyệt**, chưa vào két. Manager hoặc nhân viên được Manager bật **Được duyệt** tại trang Nhân viên duyệt; **Manager được tự duyệt phiếu mình tạo** (chính sách cập nhật 19/10/2026); nhân viên được chỉ định vẫn không được tự duyệt. Phiếu trên ngưỡng vẫn phải bấm Duyệt, không tự ghi vào két lúc tạo. Audit lưu người duyệt và dấu tự duyệt. Người được chỉ định cần quyền Sổ quỹ (`page.cash`) hoặc bán POS (`pos.sell`). Họ chỉ được xem thêm phiếu thủ công đang chờ duyệt và ảnh của phiếu đó, không được xem thu tiền bán hàng, ca hoặc tra soát của người khác nếu chưa có quyền xem tất cả. Bỏ chỉ định thì mất quyền duyệt ở yêu cầu tiếp theo. Quyền này không cho cấu hình két, lập điều chỉnh hoặc đóng tra soát. Muốn bỏ phiếu chờ thì Manager/Kế toán huỷ có lý do.
5. **Kết ca** nhập tổng tiền thực đếm; không đếm theo mệnh giá. Nếu còn phiếu chờ duyệt thì hiện danh sách và chặn kết. Lệch khác 0 chọn Đếm sai/Đưa nhầm tiền/Thiếu tiền lẻ/Khác; chọn Khác cần ghi chú. Kết ca ghi snapshot và mở một tra soát, gọi lặp không sinh trùng. In báo cáo K80 hoặc xem/in lại trong tab Ca.

Số dư toàn két = đầu kỳ + toàn bộ thu tiền mặt hợp lệ + thu/chi thủ công đã ghi. Không cộng đầu ca bàn giao thành một khoản thu mới. Tiền theo sổ trong ca = đầu ca thực đếm mới + thu tiền mặt/COD + thu thủ công − chi thủ công. Nếu ca trước bị lệch, hai số có thể khác; hệ thống không tự bù lệch. Phiếu Điều chỉnh két sửa số dư theo sổ, không phải giao nhận tiền thực, nên tách khỏi công thức tiền thực của ca mới. Nếu có nhận/chi tiền thật, dùng Thu/Rút két hoặc Chi/Nộp két tương ứng. Nhờ vậy không tính lệch cũ thêm một lần sau khi ca mới đã kế thừa số đếm.

Sau thời điểm Manager kích hoạt số đầu kỳ, phiếu thu tiền mặt tại trang công nợ cũng cần ca đang mở của người thu và ghi ngày thực thu hôm nay. Các phiếu lịch sử trước kích hoạt giữ nguyên, không tự gán vào két mới.

## Huỷ và tra soát

Manager hoặc quyền `payments.void` (mặc định Kế toán) huỷ phiếu có lý do. Phiếu vẫn hiện gạch ngang, không tính vào số dư hiện tại. Huỷ một phiếu trong ca đã kết giữ nguyên báo cáo/tiền đếm của ca đó, mở hoặc mở lại tra soát liên quan; không sửa đầu ca kế tiếp. Huỷ ghi nhận không tự hoàn tiền thực tế hay nhập lại hàng. Đơn POS bán tại quầy còn nợ sau huỷ có thể ghi lại phiếu thu tại chi tiết đơn: phải có ca đang mở, xác nhận thực nhận, tiền nguyên VNĐ và mã chống lặp; không tạo lại đơn/xuất kho. COD vẫn thu qua đúng chuyến giao trong POS.

Nhân viên kết ca ghi giải trình. Manager đóng sau giải trình và bắt buộc nêu lý do. Đóng tra soát không tự sửa sổ. Nếu cần điều chỉnh tiền, Manager lập phiếu Điều chỉnh két có lý do và tham chiếu mã TS. Mỗi ca có một tra soát; nhiều lần huỷ sau kết ca cập nhật vấn đề trên cùng tra soát và lưu từng sự kiện audit.

## Quyền, ảnh, danh sách

- Nhân viên xem các ca/phiếu/tra soát của mình. Manager và quyền `cash.view-all` (mặc định Kế toán) xem tất cả. Phạm vi này kiểm tại API, không theo chia sẻ khách hàng/phòng ban.
- Ảnh dùng FileStore private hiện có, bảng chỉ giữ khoá file; API ký link 10 phút sau khi kiểm quyền. Tải ảnh lỗi thì phiếu không được ghi.
- Tạo/duyệt/huỷ/thiết lập đầu kỳ/mở-kết ca/giải trình-đóng tra soát ghi audit trong cùng giao dịch. Audit router hiện có vẫn giữ hoạt động.
- Sổ quỹ lọc khoảng ngày theo giờ Việt Nam, tối đa 400 ngày; Xem thêm tải tiếp 100 dòng. Xuất Excel đúng các dòng đang hiển thị, không dùng những dòng đó để cộng số dư. Ca/tra soát phân trang 50 dòng. Chi tiết tra soát có tối đa 500 phiếu thủ công và 500 phiếu thu liên quan, 100 dòng nhật ký gần nhất.
- Không thay đổi lương, Sapo, cron hay đăng nhập Sapo. Không tích hợp xác nhận ngân hàng tự động hoặc ESC/POS trong đợt này.

Chênh lệch khi mở ca được lưu ngay trong tra soát và audit, không tạo phiếu thu/chi hay tự bù sổ két. Báo cáo K80 và popup hiện tiền bàn giao tham chiếu, đầu ca thực đếm và lệch mở ca riêng. Nếu kết ca khớp, tra soát mở ca vẫn chờ xử lý; nếu kết ca lệch, dùng cùng tra soát và vẫn giữ bằng chứng đầu ca từ audit. Nhân viên được giải trình ngay khi ca đang mở, Manager đóng theo quyền cũ.

Migration cho ngoại lệ Manager tự duyệt: `20261019020235_manager_cash_self_approval.sql` chỉ bỏ CHECK cấm mọi người tự duyệt. Triển khai trước API mới; server vẫn chặn nhân viên được chỉ định tự duyệt và audit ghi `selfApproved`.

### Giới hạn két theo cửa hàng

NVBH/CHT Lock chỉ thấy két gắn quầy Lock; NVBH/CHT Minh Long chỉ thấy két gắn quầy Minh Long (xem quy tắc nhận diện trong POS.md). Phạm vi áp dụng cả danh sách và ID truy cập trực tiếp, ảnh phiếu, duyệt/huỷ, ca và tra soát. Người được chỉ định duyệt không được vượt phạm vi này. Manager vẫn xem và thao tác cả hai theo quyền hiện có. Không thay đổi số dư hay báo cáo đã chốt.

## Hoàn tiền hàng POS

Phiếu trả hàng được duyệt và xác nhận thực nhận mới phát sinh giá trị trả. Tiền thực hoàn ghi bằng `pos_refunds`; hoàn tiền mặt kèm `cash_entries.kind=customer_refund`, hướng chi, vào ca/két đang mở lúc thực trả. Dùng người duyệt của yêu cầu, không bắt duyệt lần hai sau khi đã trả tiền. Chuyển khoản hoàn không trừ két. Thanh toán bằng tiền đổi hàng là `method=other`, `payment_source=pos_exchange_credit`, không tính tiền thực thu trong két hoặc Sổ thu/chi.

Huỷ phiếu thông thường bị chặn cho hoàn tiền đã xác nhận và các phiếu thu có chứng từ trả/đổi liên kết, để không âm thầm làm sai tiền được hoàn. Báo cáo ca đã kết giữ nguyên; hoàn ở ca sau ghi chi ở ca sau. Xem [POS-RETURNS-PREFLIGHT.md](POS-RETURNS-PREFLIGHT.md) để biết migration và giới hạn triển khai.

## Cọc nhận sau / ship trả trước

Chỉ `customer_payments` thực nhận mới vào báo cáo: `pos_deposit`, `pos_balance`, `pos_prepaid`. Tiền mặt vào két ca thực thu; chuyển khoản không vào két. `pos_payment_intents` đang chờ không phải phiếu thu; xác nhận sau khi ca gốc kết thì ghi ca mới cùng quầy/két, không sửa snapshot ca gốc. Đơn còn cọc/chờ chuyển khoản không chặn kết ca, ngưỡng duyệt phiếu thủ công không áp cho tiền bán thực nhận.

Huỷ đơn trước xuất dùng `pos_returns.request_context=before_fulfillment`: chỉ giảm công nợ khi được duyệt; không cần và không được nhập kho. Sau duyệt mới thực hoàn hoặc dùng tín dụng, không vượt tiền thực nhận còn lại. Hàng đã xuất chưa giao dùng `after_issue`: duyệt dừng giao, thực nhận lại mới ghi nhập/giảm công nợ và mở tiền hoàn. Tiền mặt hoàn thuộc ca đang mở khi thực trả, chuyển khoản cần tham chiếu. Manager được tự duyệt có audit; người được chỉ định không tự duyệt và không vượt scope cửa hàng. Xem [POS.md](POS.md) và [phương án dữ liệu đã duyệt](POS-DEPOSIT-PREPAID-PREFLIGHT.md).

## Bảng tra soát (tab "Tra soát" ở Sổ quỹ)
- Lọc **Cần xử lý** (mặc định: chờ giải trình + chờ Manager đóng) · **Đã đóng** · **Tất cả**, có số đếm (`GET /cash/reconciliations?status=open|closed|all` trả `counts`).
- Mỗi dòng: ngày ca, mã, **Thừa / Thiếu** (màu), số theo sổ và thực đếm, trạng thái và bước tiếp theo. Nút chính đổi theo người xem: *Giải trình* (nhân viên của ca) hoặc *Xem & đóng* (Manager).
- Hộp chi tiết: ba ô số (theo sổ, thực đếm, thừa/thiếu), dòng thời gian 3 bước (ghi nhận lệch + lý do → giải trình → Manager đóng), form đúng bước. Phiếu trong ca và nhật ký (nhãn dễ đọc) thu gọn bên dưới.
- Form giải trình hiện cho **nhân viên của ca** (khớp máy chủ), không theo người bấm kết ca.
