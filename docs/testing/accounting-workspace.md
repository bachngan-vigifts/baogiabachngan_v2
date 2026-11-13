# Không gian kế toán — triển khai theo giai đoạn

## Phạm vi

Sổ kế toán riêng `#/accounting`, chỉ Manager và nhân viên có chính xác `positionId=accounting` được đọc/ghi theo vai trò. Không dùng quyền rộng `purchases.pay` để suy ra quyền kế toán. API kiểm tra độc lập với menu. Không có export/public share; anonymous và các chức vụ khác không có API dữ liệu. Các bảng được bật RLS, thu hồi quyền PUBLIC/anon/authenticated; phiên nhân viên hiện tại được xác minh ở API như các module CRM hiện có.

Hai sổ được chủ hệ thống xác nhận:

- Kho tổng Vigifts — nhà cung cấp hóa đơn Viettel.
- Kho tổng Bách Ngân — nhà cung cấp hóa đơn VNPT.

Migration chỉ tạo bảng/sổ rỗng. `entity_id` và `opening_date` để NULL, không suy ra tồn bằng 0, không gán MST từ thương hiệu. `created_by=NULL` của hai sổ khởi tạo thể hiện provisioning bằng migration, không mạo danh nhân viên. Tạo mới từ giao diện vẫn lưu người tạo.

Không tạo dòng trong `warehouses`, `stock_moves`, `stock_balances`; không cộng sổ kế toán vào tổng tồn trang chủ. Không sao chép số dư vật lý sang sổ thuế.

## Quy trình sử dụng sau khi phát hành

1. Menu **Tiền & công nợ → Không gian kế toán** (Manager/Kế toán).
2. Manager thêm tên pháp nhân và MST đúng hồ sơ; gán vào từng sổ. Sổ có chứng từ không cho đổi pháp nhân.
3. Chọn pháp nhân, sổ và kỳ. Nhập chứng từ đầu kỳ với nguồn đối soát. Đầu kỳ rỗng chỉ được mở khi đánh dấu xác nhận số dư bằng 0; không tạo mã giả.
4. Manager mở chứng từ nháp, kiểm tra và duyệt ghi sổ. Nháp không ảnh hưởng số dư. API kiểm tra phiên bản, khóa pháp nhân và chặn ghi gây âm tồn ở bất kỳ chứng từ lịch sử sau đó.
5. Nhập chứng từ mua/bán ngoài CRM có thật, hoặc chọn **Đối chiếu đơn bán**. Đơn CRM/POS giữ nguyên SKU/đơn vị/số lượng/tiền trước VAT từ server; dữ liệu dòng do client gửi không được dùng. Không có chọn mã tồn nhiều để khớp tổng tiền. Không đối chiếu tự động đơn có yêu cầu trả đang hoạt động, đơn đã ghi phát hành, dòng thiếu SKU, phụ phí hoặc tổng dòng lệch tổng đơn.
6. Manager hủy đối chiếu với lý do khi cần; giữ chứng từ và lịch sử, kiểm tra ảnh hưởng số dư. Thao tác này không hủy hóa đơn đã phát hành ngoài hệ thống.
7. Xác nhận đầy đủ chứng từ tháng đã kết thúc. Ghi sổ/hủy chứng từ phát sinh sẽ gỡ xác nhận từ tháng liên quan trở đi, tránh hiển thị tỷ lệ như đã đối soát.

## Cách tính và giới hạn nghiệp vụ

- Sổ quản trị dùng bình quân liên hoàn, giá trị trước VAT, từng SKU + đơn vị + sổ. Đây chưa thay thế phần mềm kế toán hoặc phương pháp tính giá vốn đã đăng ký của doanh nghiệp.
- Tồn đầu kỳ + nhập mua − giá vốn xuất; giá bán và giá vốn tách riêng. Tiền nguyên đồng, lượng tối đa 3 chữ số lẻ; không cộng các đơn vị khác nhau. Có kiểm tra giới hạn số nguyên chính xác.
- Cảnh báo: thiếu đầu kỳ, thiếu thuế suất, thiếu giá vốn, tồn âm, chậm luân chuyển, ngày tồn dự kiến cao, nhập/xuất mất cân đối, bán dưới giá vốn và tỷ lệ vượt tham chiếu. Ngưỡng tồn là **ngưỡng quản trị nội bộ**, không phải ngưỡng pháp luật.
- Tỷ lệ hiển thị = xuất bán ròng / (giá trị tồn đầu kỳ + nhập mua ròng), cùng kỳ và trước VAT. Luôn theo toàn pháp nhân/MST, không bị thu hẹp bởi bộ lọc sổ. Thiếu đầu kỳ, xác nhận đầy đủ tháng hoặc mẫu số không dương: **Chưa đủ dữ liệu**, không hiển thị xanh.
- Không gán một hệ số K thuế chung. Tham số tham chiếu chỉ được Manager nhập kèm nguồn và ngày xác nhận; UI ghi rõ tỷ lệ nội bộ không phải kết luận thuế. Cần kế toán xác minh phạm vi giá trị, kỳ và tham số cơ quan thuế áp dụng thực tế cho MST trước khi dùng để đối chiếu chính thức.
- Tham khảo: [Công văn 2392/TCT-QLRR](https://thuvienphapluat.vn/cong-van/Thue-Phi-Le-Phi/Cong-van-2392-TCT-QLRR-2023-kiem-tra-hoa-don-dien-tu-569583.aspx). Văn bản tham khảo không thay cho việc xác minh hướng dẫn hiện hành và tham số riêng của doanh nghiệp.
- Không tự áp 8% cho chứng từ lịch sử. Thuế suất phải theo hồ sơ/mặt hàng/ngày hiệu lực.
- Chưa nhập tự động hóa đơn từ Viettel/VNPT; vì vậy thiếu hóa đơn đầu vào và cảnh báo chênh giữa CRM với cơ quan thuế chưa thể kết luận tự động.
- Chưa bật trả hàng/điều chỉnh: API từ chối rõ ràng, cần luồng đối soát chứng từ và giá trị gốc trước khi mở. Không giả định tiền hàng trả bằng giá bán.
- Mỗi báo cáo giới hạn 12 tháng, 2.000 chứng từ và 10.000 dòng bao gồm lịch sử tính tồn. Vượt giới hạn trả lỗi thay vì âm thầm cắt và tính sai. Chưa có chốt số dư để xử lý lịch sử lớn.

## AI và hóa đơn điện tử

- Đối chiếu SKU là quy tắc xác định từ đơn thật, không gắn nhãn AI.
- Có adapter giải thích cảnh báo, mặc định tắt. Chỉ bật server khi đã duyệt nhà cung cấp/xử lý dữ liệu và cấu hình `ACCOUNTING_AI_ENABLED=true`, `ACCOUNTING_AI_PROVIDER=openai`, model và secret riêng trong môi trường máy chủ. Không gửi secret từ trình duyệt, không in giá trị secret.
- Dữ kiện gửi AI chỉ có mã cảnh báo, một giá trị số, trạng thái đủ dữ liệu và trạng thái tỷ lệ. Không gửi tên khách, MST, số tài khoản, ghi chú, toàn bộ chứng từ hoặc prompt do người dùng nhập. AI không có công cụ ghi database/phát hành; kết quả luôn cần người kiểm tra, được escape khi hiển thị.
- Viettel/VNPT mới là metadata; không có kết nối tài khoản, ký số, phát hành hay hủy hóa đơn. Cần tài liệu API, môi trường thử và phương án phê duyệt riêng trước khi triển khai tích hợp đó. Không yêu cầu người dùng gửi mật khẩu/token trong chat.

## Database và phát hành

Migration mới: `migrations/postgres/20261113002619_accounting_workspace.sql`, tạo bằng CLI Supabase. Không sửa migration đã chạy. Cổng chỉ đọc: `scripts/sql/assert-accounting-workspace.sql`, nối vào deploy API và danh mục kiểm tra migration tháng 11. Cổng dừng khi thiếu bảng, RLS, cột quan trọng hoặc ràng buộc chống trùng đơn; không tự sửa schema trong deploy.

Sau khi áp dụng: xác minh hai sổ, entity/opening NULL, không có chứng từ hoặc số dư tự sinh; kiểm tra RLS/quyền trực tiếp và chạy assertion. Rollback ứng dụng bằng bản API/UI cũ; giữ bảng bổ sung và lịch sử, không DROP dữ liệu kế toán.

## Kiểm thử

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/accounting-domain.test.ts tests/accounting-workspace.test.ts tests/db/migration.test.ts tests/db/constraints.test.ts tests/db/november-migration-gates.test.ts tests/app/trial-ui.test.ts tests/app/routes.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/accounting-workspace.mjs
```

Đã chạy PostgreSQL WASM trên database trống, toàn bộ chuỗi migration, chạy lại migration mới, kiểm tra cổng trong transaction READ ONLY và schema thiếu cột. Kiểm tra API quyền, duyệt, chống trùng/stale, đầu kỳ rỗng, K chưa đủ dữ liệu, vô hiệu xác nhận kỳ, đối chiếu SKU thật và tồn vật lý giữ nguyên. PGlite có một kết nối; chưa xác minh cạnh tranh nhiều kết nối trên PostgreSQL thật.

Chromium dùng app/API thật với dữ liệu thử: Manager ở 320/390/1440px, Kế toán 430px; Kho 390px và Sale 1440px bị chặn URL trực tiếp. Kiểm tra không tràn ngang, popup desktop 16:9, nút nằm trong viewport, mở lại form sạch và không lỗi JS. Ảnh: `/tmp/accounting-workspace`.
