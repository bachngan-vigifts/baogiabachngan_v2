# Thưởng KPI Sale trên doanh số net

Theo yêu cầu chủ doanh nghiệp, từ kỳ 10/2026 (tham số `saleKpiNetFrom=202610`) cho phiếu chưa chốt:

| Tổng KPI | Thưởng / doanh số net |
|---|---|
| <60% | 0 |
| 60%–<90% | 0,5% |
| 90%–120%, gồm đúng 120% | 1% |
| >120% | 1,2% |

Net = subtotal của đơn đủ điều kiện ghi nhận theo kỳ ngày đơn − hoa hồng khách hàng. Không dùng tổng gồm VAT, không trừ thêm giá vốn/in/vận chuyển. Hoa hồng theo định nghĩa đang dùng trong Lợi nhuận báo giá: % trên đơn giá sau CK không gồm phí in, hoặc số tiền mỗi SP × SL; dùng lượng/giá của đơn. Dòng xác nhận không hoa hồng (`excluded`) tính 0. Đơn POS không có cơ chế hoa hồng này, dùng subtotal. Đơn CRM thiếu báo giá, thiếu căn cứ hoa hồng hoặc dòng nguồn không khớp được đánh dấu cần đối chiếu và chặn chốt cá nhân/cả bảng. Không mặc định hoa hồng chưa khai báo là 0.

Tiền thưởng được chặn tối thiểu 0 nếu tổng net âm. Không đổi cách tính tổng điểm KPI/nguồn doanh số tính điểm hoặc quy đổi ngày làm hàng/công tác trong thay đổi này. Chỉ thay bậc thưởng và cơ sở tính tiền thưởng. Cách giảm chỉ tiêu so với cộng quy đổi còn cần chủ doanh nghiệp chốt riêng.

Sale không nhận khoản sao/thanh lý mới từ kỳ áp dụng. Sale Admin giữ sao/thanh lý, không KPI. Các khoản điều chỉnh quyền hưởng đã ghi nhận ở kỳ trước vẫn giữ người nhận cũ. Không tự đổi người phụ trách đơn hoặc chuyển tiền thưởng sang người khác.

Phiếu đã chốt giữ bản chụp cũ. Tháng trước kỳ áp dụng giữ chính sách cũ. Cấu hình mới nằm trong JSON hiện có; không migration, không chỉnh payroll production. Nguồn số liệu được bơm qua hợp đồng app/core, HR không import Sales/Quotes. UI và Excel dùng khoản KPI đã tính trên server; phiếu hiện rõ cơ sở net/cảnh báo căn cứ.

Kiểm chứng:

- Typecheck và kiểm tra cú pháp JS.
- Test ngưỡng 59,999 / 60 / 89,999 / 90 / 120 / >120 và sai số số thực; API loại VAT, trừ hoa hồng; không sao cho Sale; giữ thưởng Admin; snapshot bất biến; thiếu căn cứ chặn cả hai cách chốt; source thay đổi yêu cầu xem lại trước khi chốt.
- Kiểm thử hồi quy HR/ledger/KPI cũ, hồ sơ nhân viên, quyền, mẫu trang và ranh giới module bằng Node 22.22.0 giống CI. Dữ liệu mồi kiểm tra hoa hồng được Manager xác nhận, không bỏ qua bảo vệ dữ liệu chi phí.
- Chromium thực, router + PostgreSQL WASM: 1280/390 px, thay KPI từ 120% sang 130% qua form thật; trước VAT 100 triệu, hoa hồng 5 triệu, net95 triệu → thưởng 950.000 / 1.140.000. Không sao, không lỗi JS. Ảnh/JSON chỉ chứa dữ liệu giả lập. Harness `scripts/testing/sale-kpi-net.mjs`.
