# Giao dịch thực tế → KPI và thưởng Sale / Sale Admin

## Phạm vi và mặc định

Phát triển trên trang `#/care`, giữ nhật ký và lịch hẹn cũ. Menu mới “Giao dịch & chăm sóc”; tab ghi nhận tiền ở hồ sơ khách/nhân viên đổi tên “Phiếu thu” để không nhầm với hoạt động KPI. Sale có KPI theo hồ sơ lương. **Sale Admin không áp dụng KPI/KPI cố định hoặc thưởng quý tự động theo KPI**; chỉ bật thưởng sao HĐKT và thanh lý. Không viết cứng tên người, không mở quyền sửa lương cho Sale Admin.

- Gọi đã kết nối, gặp đã thực hiện, tư vấn thực chất qua Zalo/email, báo giá đã gửi: mỗi hoạt động hợp lệ = 1 giao dịch.
- Chăm sóc sau bán là mục đích của hoạt động, không cộng thêm một lần cho cùng cuộc gọi.
- Không tính hoạt động chưa thực hiện/không kết nối, thiếu nội dung/người liên hệ, lịch sử chưa xác nhận, hoặc báo giá chưa gắn bản đã gửi.
- Cùng khách/người thực hiện/hình thức/ngày Việt Nam: một lần; Manager có thể xét hoạt động riêng bổ sung, phải có lý do. Cùng bản báo giá không cộng lại kể cả khác tháng/người gửi. Có thể chọn phiên bản báo giá đã lưu trong lịch sử.
- Đây là nhật ký nhân viên xác nhận; không tích hợp tổng đài, Zalo/email và không chứng minh tự động khách đã nhận. Không gửi tin ra ngoài.
- Theo dõi hợp lệ trước phân trang, lọc của tôi/nhóm, lọc KPI. Hẹn tiếp là tuỳ chọn, hoàn thành hẹn không tự biến thành giao dịch KPI.
- POST có intent UUID riêng, lưu hash nội dung và unique theo người tạo intent (không theo người phụ trách có thể đổi). Gửi lại cùng mã không ghi thêm; khác nội dung 409. UI khoá khi ghi, giữ payload/mã khi chưa rõ kết quả; không có hàng đợi offline hoặc cam kết khôi phục draft sau xoá bộ nhớ trình duyệt.

## Số liệu và quyền

App lắp `crmFactsOf` từ care/sales vào HR; HR không import sales/care. KH mới = khách định danh có đơn CRM đầu tiên đã duyệt, xét toàn lịch sử và loại nháp/huỷ. Không suy đoán khách lẻ POS/đơn web thành KH mới. Số HĐ = HĐKT ký trong tháng, signed/completed, đơn chưa huỷ. Doanh số KPI hiện có vẫn theo `memberRevenues` (gồm VAT); riêng xếp sao HĐKT dùng `subtotal` trước VAT.

Ô KPI null lấy CRM khi áp dụng; số 0 nhập tay giữ là 0 (phần cộng ngày làm hàng/công tác vẫn theo công thức hiện có). Với Sale, KPI cố định ưu tiên hơn KPI chốt tháng, rồi mới công thức. Sale Admin được loại ở máy chủ dù hồ sơ cũ còn cờ KPI; API không cho bật KPI hay KPI cố định cho chức vụ này. Thưởng KPI chỉ khi hồ sơ bật KPI ở bảng Sale & Văn phòng. Thưởng HĐKT bật độc lập trên hồ sơ Sale / Sale Admin.

Hồ sơ lương chỉ Manager sửa, nhân viên xem lương của chính mình như trước. Chi tiết thưởng không nối thẳng tới HĐKT ngoài quyền; khi người nhận cũ không còn phụ trách, phần tạm tính cho nhân viên ẩn fact/ID hợp đồng và chỉ giữ khoản điều chỉnh của họ. Phiếu lương cũ giữ dữ liệu tại thời điểm chốt.

## Thưởng và sổ ghi nhận

Sao theo cận dưới: 2 triệu/20 triệu/100 triệu/500 triệu/1 tỷ trước VAT; tiền 20.000/50.000/100.000/200.000/500.000 đồng. Dưới 2 triệu bằng 0. Thưởng sao theo tháng ký. Thưởng thanh lý 10.000 đồng theo tháng Manager duyệt trong PR #399; chỉ tính khi kiểm tra nghĩa vụ hiện tại và snapshot vẫn hợp lệ. Không lấy status `completed` cũ hoặc tự đoán ngày từ audit.

Hai bảng HR: quyền hưởng duy nhất `(contract_id,kind)` và các lần ghi nhận có dấu theo phiếu/run. Chốt tạo `reserved`, đánh dấu trả chuyển `paid`, mở lại phiếu chưa trả chuyển `released`, không xoá lịch sử. Quyền hưởng 0 sao cũng được ghi nhận để theo dõi nâng hạng sau này.

Chênh lệch = đáng hưởng theo chính sách gốc − tổng khoản chưa giải phóng (cả đã chốt chưa trả và đã trả). Huỷ/không còn đủ điều kiện có thể âm, tăng hạng trả thêm; không áp bảng giá thưởng mới hồi tố lên quyền đã ghi nhận. Người nhận giữ theo lần chốt; chuyển người phụ trách không tự chuyển thưởng đã ghi nhận. Phiếu sau không được lấy phần thưởng đã ghi ở kỳ tương lai; mở lại kỳ gốc có điều chỉnh phía sau phải xử lý các kỳ sau từ mới nhất trước. Phiếu âm không tự đánh dấu đã trả hoặc tự thu tiền.

HR writes và thay đổi nguồn care phối hợp bằng khóa transaction. Chốt giữ khóa đọc bản ghi HĐKT/đơn liên quan, kiểm tra hash bản xem trước và ghi sổ cùng transaction. Chốt từng người/hàng loạt chung cơ chế. Nguồn giao dịch đã dùng trong phiếu chốt KPI tự động bị khoá; phiếu cũ hoặc chế độ đối chiếu không tự khoá lịch sử care.

Snapshot v2 lưu cách tính, chính sách, đầu vào, thưởng và run. Phiếu cũ không được bổ sung thưởng từ dữ liệu hiện tại. Snapshot thiếu/hỏng chỉ hiển thị tổng tiền đã lưu, cảnh báo thiếu chi tiết và không in/xuất Excel chi tiết cho tới khi đối soát. Không tự tính lại tiền cũ.

## Trình tự đưa vào sử dụng

PR này dùng nguồn thanh lý của #399; #399 đã merge, PR này vẫn không tự merge/deploy.

1. Migration thanh lý `20261031041111_contract_liquidation_review.sql` của #399 đã chạy theo yêu cầu riêng của chủ doanh nghiệp. Không chạy lại.
2. Sau đó tự chạy `migrations/postgres/20261031052408_sales_activity_kpi_payroll.sql` của PR này. File sinh bằng Supabase CLI `migration new`; chưa chạy trên CRM. Bảng mới RLS, không cấp anon/authenticated. Không backfill hoạt động cũ, ngày thanh lý hoặc thưởng đã trả.
3. Triển khai API/UI sau schema theo quy trình repo. Khi rollback app, giữ schema/sổ thưởng để đối soát; không xoá bảng/ảnh/chứng từ.
4. Manager vào Tham số, chọn `salesAutomationFrom=YYYYMM`, `salesAutomationApply=0`; đặt trần KH mới `kpiNewCustomersOver=10%` theo chính sách đã chốt. Bật KPI cho Sale; chỉ bật thưởng sao HĐKT và thanh lý cho Sale Admin ở hồ sơ những người được hưởng. Mặc định hệ thống là chưa bật (`from=0`, `apply=0`), không tự sửa thực nhận cũ.
5. Chạy đối chiếu một tháng. Sau khi đã đối soát, lưu bản tham số từ tháng chính thức với `salesAutomationApply=1`. API yêu cầu trần KH mới không vượt 10% trước áp dụng. Không đổi công thức KPI cốt lõi.

Các mặc định nghiệp vụ cần duyệt trong review: KH mới theo đơn đầu tiên, người nhận thưởng đã chốt được giữ nguyên khi đổi chủ đơn, thanh lý theo ngày Manager duyệt, lịch sử chưa xác minh không tự ghi có. Muốn chính sách khác phải đổi có hiệu lực theo tháng, không sửa âm thầm dữ liệu đã trả.

## Kiểm chứng cục bộ

- TypeScript đạt. 66/66 kiểm thử hồi quy (HR, care, HĐKT, phân quyền, UI, schema/constraints); 21/21 kiểm thử HR/care/HĐKT chạy lại trên thay đổi cuối. API thật/PGlite và các migration chỉ trong DB kiểm thử tạm.
- Biên sao, trước/sau VAT, null/0, ngày làm hàng, KPI cố định, khoản ký/thanh lý khác tháng, huỷ/tăng hạng, giữ chính sách và người nhận cũ, mở lại/kỳ sau, chốt đồng thời, nguồn đã chốt, quyền HR và quote/customer scope, quote revision/replay, phân trang, snapshot cũ.
- `scripts/testing/sales-activity-payroll.mjs`: CRM đầy đủ + API/PGlite, Chromium 1280/390, chặn mạng ngoài. Tạo giao dịch, 502 sau commit/thử lại cùng intent, loại trùng, Manager xét bổ sung, đối chiếu → bật áp dụng → chốt; Excel thật có cột thưởng và điều chỉnh. Ảnh trong thư mục là dữ liệu tổng hợp.
- Không truy vấn/ghi production, không chạy migration trên CRM, không thay phiên/cron/đồng bộ Sapo, không gọi GHN/email/Zalo.

Bổ sung theo xác nhận của chủ doanh nghiệp: Sale Admin không KPI; kiểm thử API, dữ liệu hồ sơ cũ, loại khỏi thưởng quý tự động và giao diện hồ sơ không còn nút bật KPI. Thưởng 2 sao 50.000 + thanh lý 10.000 vẫn hoạt động. Đổi chức vụ sau khi đã chốt không sửa snapshot phiếu cũ.
