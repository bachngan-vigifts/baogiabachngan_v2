# Mobile Sơ đồ quy trình và phục hồi danh sách nhân viên

## Nguyên nhân và thay đổi

- Trên bản trước aa6e04c, mobile workflowPages đánh dấu read-only các nút dựa trên toàn bộ text. Vì tên chỉ số có “chờ duyệt” / “chưa ký”, 5/11 ô điều hướng sơ đồ bị ẩn như nút ghi. action policy cũng có thể nhận nhầm số đếm có từ huỷ. Gắn `data-mobile-navigation` chỉ cho thao tác đọc/điều hướng; hai lớp mobile presentation giữ các nút này tại chỗ. Nút ghi/duyệt/xoá không được gắn cờ này, quyền server không đổi.
- Canvas desktop có min-width 940px trong board 356px ở viewport390. Mobile dùng lưới mục 2 cột và 6 nút giai đoạn vừa màn hình; mỗi mục có nhãn giai đoạn. Desktop giữ các mũi tên / bố cục cũ. Resize về desktop vẽ lại mũi tên.
- Panel chi tiết z-index61 thấp hơn header62 nên nút đóng bị header chặn. Đưa shade/panel lên70/71 và ra ngoài workspace fixed (stacking context thấp hơn các nút nổi / menu ở body), tự đóng khi đổi route hoặc ẩn workspace lúc logout. Bố trí panel vừa viewport và safe area; giữ đóng bằng nút / Escape / nền ngoài panel.
- Lỗi API danh sách nhân viên trước đó bị catch gán [] rồi hiện “Không có nhân viên phù hợp”. Giữ dữ liệu cũ nếu có, thêm lỗi tải riêng và nút Thử tải lại; không hiện empty-state khi chưa tải được.
- PR407 đã yêu cầu chạy tay migration staff_employment trước deploy. Thêm schema gate chỉ đọc trước bước deploy Edge Function: kiểm tra ba cột đúng kiểu. Nếu thiếu, fail rõ tên file cần chạy tay; không tự áp dụng migration. Các bước Sapo/cron hiện có không thay đổi.

## Migration

Không thêm migration mới. File `20261031230043_staff_employment.sql` được chủ doanh nghiệp cho phép chạy để phục hồi production và đã chạy thành công. Kiểm tra lại ba cột tồn tại và RLS vẫn bật; không sửa/xoá hồ sơ nhân viên, không đổi số tiền hay phiếu lương. Không lưu dữ liệu nhân viên production trong tài liệu/ảnh.

## Kiểm chứng

- Typecheck và cú pháp JS / diff check đạt.
- Node22: flow (quyền Manager / nhân viên / kho), mobile action policy, trial-ui và schema gate đều đạt. Schema gate thử DB có đủ cột và DB thiếu cột: từ chối deploy, không tự thêm cột.
- Chromium Playwright chạy app/router/PGlite thực; chặn toàn bộ mạng ngoài máy thử. Before dùng đúng asset ở commit aa6e04c; 390px ẩn5/11 ô, canvas940px trong board356px.
- After: 320/390/430/850/1280px. Mọi ô do API cho phép đều hiển thị; mở/đóng toàn bộ11 ô và giai đoạn, đọc chỉ số; không tràn trang hoặc board mobile. Resize mobile→desktop→mobile giữ đủ ô và vẽ lại mũi tên desktop. Không lỗi JS. Kiểm tra hit-test bảng chi tiết nằm trên nút nổi; đổi route / ẩn workspace tự đóng overlay. Dòng đọc có chữ chờ duyệt vẫn hiện, nút Duyệt thật giữ ẩn trên mobile và hiện trên desktop theo chính sách cũ.
- Mô phỏng GET /admin/members lỗi500: hiện lỗi tải, không hiện “không có nhân viên”; bỏ lỗi và bấm Thử tải lại thì có danh sách.
- Ảnh/JSON là dữ liệu giả lập; chưa kiểm tra trên máy Safari thật. Harness: `scripts/testing/mobile-flow.mjs`; chạy `FLOW_PHASE=before` để tái hiện asset cũ.
