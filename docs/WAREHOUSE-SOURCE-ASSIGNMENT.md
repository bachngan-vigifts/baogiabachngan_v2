# Phân công việc Kho từ phiếu nguồn

## Luồng sử dụng

Manager mở **Kho của tôi → Phân công việc tự sinh**. Sau khi lưu thao tác đóng gói, điều chuyển hoặc nhận hàng NCC, giao diện đồng bộ lại việc từ phiếu và mở popup khi hộp thoại nghiệp vụ đã đóng. Công việc lấy từ task tự sinh hiện có, không nhập một tiêu đề thay thế.

- Một nhân viên: giữ nguyên task nguồn, thêm theo dõi định mức.
- Cả team: chọn ít nhất hai nhân viên cùng kho, một phụ trách chính; khai báo phần việc, phút công chuẩn và tỷ trọng khối lượng từng người. Tổng trọng số bằng một việc nguồn. Task cha và các lời nhắc trùng cho nhân viên Kho không bị cộng thêm điểm.
- Người rảnh được ưu tiên; nếu tất cả bận, so hệ số hoàn thành có xác nhận trong 30 ngày, rồi số việc đang chờ. Không có lịch sử xác nhận thì hiện “Chưa đủ dữ liệu”, dùng số việc chờ làm căn cứ phụ.
- Nhân viên bận nhận phần việc chờ lượt. Giữ cơ chế một việc đang làm/chờ nhận mỗi người; không tự ghi thời gian đã làm.
- Phải duyệt định mức và hạn theo dõi trước khi bắt đầu. Nếu hạn nguồn đã qua, Manager đặt hạn theo dõi mới và ghi lý do; ngày trên chứng từ gốc giữ nguyên.
- Xác nhận kết quả chỉ sau khi chứng từ hoàn tất đúng bước. Hủy nguồn giải phóng phần việc chưa xác nhận; phần chưa bắt đầu khi nguồn đã hoàn tất bị loại, không được nhận điểm.
- Tồn kho vẫn do nghiệp vụ chứng từ hiện có ghi nhận. Thưởng chỉ vào lương sau khi duyệt tháng qua cơ chế hiện có.

## Phạm vi và quyền

Hiện dùng các producer sẵn có: phiếu đóng gói đã gửi, giao hàng cần đóng, điều chuyển xuất/nhận, nhắc nhận hàng NCC/lấy trước, nhập kho Sapo. Không dựng producer kiểm kê mới. Phiếu lấy trước gắn nhiều kho hoặc không xác định được kho không được tự đoán người nhận.

Chỉ Manager xác nhận phân công. Danh sách nhận việc gồm nhân viên Kho đang hoạt động, có phân công tại kho nguồn. Kiểm tra lại quyền kho khi bắt đầu/tiếp tục phần việc. Gửi thông báo xác nhận cho đúng thành viên đã chọn. Các việc duyệt riêng của Manager/Sale Admin không bị gộp vào lời nhắc Kho.

Các assignment đã chuẩn bị không được ghi đè bằng payload khác. Nhánh này chưa cung cấp sửa cấu trúc team sau khi bắt đầu; không tự chuyển lịch sử sang người khác. Công việc lịch sử đã có run được giữ luồng cũ. Việc không đủ cấu hình ca/định mức vẫn cần Manager chuẩn bị, không tự bịa dữ liệu để chấm điểm.

## Dữ liệu và triển khai

Migration cộng thêm `migrations/postgres/20261111061143_warehouse_source_assignment.sql` tạo ba bảng metadata: `warehouse_work_assignments`, `warehouse_work_source_links`, `warehouse_work_parts`. RLS bật; PUBLIC/anon/authenticated không có quyền trực tiếp, API kiểm tra quyền. Không backfill hoặc sửa tồn kho/lương cũ.

Thứ tự triển khai:

1. Kiểm tra migration trên Preview, chạy `scripts/sql/assert-warehouse-workspace.sql`.
2. Áp migration rồi deploy API và UI cùng phiên bản. API truy vấn các bảng mới nên không deploy API trước migration.
3. Sau khi API hoạt động, cài `supabase/warehouse-work-assignment-cron.sql` để sửa các sự kiện bỏ lỡ mỗi 5 phút, không phụ thuộc trình duyệt mở. Script tái sử dụng token máy chủ trong Vault; không đưa token vào UI/chat.
4. Kiểm tra một phiếu thử đúng kho: người rảnh, tất cả bận, team, xác nhận nguồn, hủy nguồn. Không bật cron trước khi endpoint được deploy.

Nhánh phát triển không tự chạy migration/cron của tính năng này trên production. Script lịch sử migration đã được cho phép riêng cho Preview #613 là thao tác độc lập.

## Kiểm thử và tốc độ

`tests/app/warehouse-source-assignment.test.ts`: phân quyền, lưu lặp/concurrent requests, team chia trọng số, source guard, việc bận chờ lượt, tháng chốt, alias theo người nhận, tách các PO, quyền/RLS và chạy migration lần nữa. PGlite dùng một kết nối nên không thay thế thử nghiệm cạnh tranh nhiều kết nối PostgreSQL.

`scripts/testing/warehouse-source-assignment.mjs`: Chromium + UI/API thật trên fixture, chặn mọi request ra ngoài; PC 1440, mobile 390, mất phản hồi sau commit rồi retry, worker mở đúng phần việc, không tràn ngang/không lỗi JS.

`scripts/testing/warehouse-workspace-performance.mjs`: so với commit nền `14cadee2`, cùng `homeFixture`, Chromium mobile 390×844, ba lần reload sau đăng nhập/mỗi bản, không throttling, localhost/PGlite, chặn request ngoài. Median lần đo tuần tự:

| Chỉ số | Nền | Sau thay đổi |
|---|---:|---:|
| Load event | 512,4 ms | 502,6 ms |
| TTFB HTML | 8,7 ms | 7,4 ms |
| FCP | 120,0 ms | 124,0 ms |
| LCP | 644,0 ms | 560,0 ms |
| CLS | 0,0860 | 0,0860 |
| Đợi `.ww-page` | 662,9 ms | 570,3 ms |
| Handler GET workspace | 24,9 ms | 26,0 ms |

Đây là dữ liệu kiểm thử tổng hợp, cache trình duyệt đã khởi động (Playwright routing tắt HTTP cache), không phải production hay bằng chứng cải thiện tốc độ thực tế. Chưa thấy chậm rõ ở fixture nhỏ; số đo có dao động giữa các lần chạy; chưa suy ra khả năng đáp ứng với hàng nghìn phiếu. LCP được quan sát đến 500 ms sau khi workspace xuất hiện. Khi rollout cần đo lại trên staging có quy mô dữ liệu tương đương.


## Rà soát mở rộng 11/11

Xem [ma trận vai trò/kho và các lỗi đã sửa](testing/warehouse-assignment-audit.md), [kết quả đo và kiểm thử](testing/warehouse-assignment-audit.json). Kiểm tra quyền nghiệp vụ và nhân viên hoạt động khi phân công/bắt đầu; chuẩn bị lại đề xuất chưa duyệt nếu người cũ đã khóa. Cho đặt hạn được duyệt khi phiếu chưa có ngày hẹn, không ghi lại ngày trên chứng từ. Lời nhắc mới nối vào assignment đã chuẩn bị. Phần việc bị trả lại có thể làm lại sau khi nguồn hoàn tất, giữ giờ công và lỗi lần đầu.

So với bản PR `584766b8`, cùng điều kiện browser/fixture như trên, median 3 lần mỗi bản:

| Chỉ số | Trước audit | Sau audit |
|---|---:|---:|
| Load event | 508,4 ms | 462,3 ms |
| TTFB HTML | 9,0 ms | 7,0 ms |
| FCP | 124,0 ms | 112,0 ms |
| LCP | 520,0 ms | 528,0 ms |
| CLS | 0,0860 | 0,0860 |
| Workspace sẵn sàng | 553,9 ms | 533,6 ms |
| Handler GET workspace | 25,6 ms | 18,8 ms |

Popup: median 101,9 ms qua 3 lần mở trên fixture. Chưa thấy chậm rõ trong phạm vi thử nghiệm này; không suy ra tốc độ production.
