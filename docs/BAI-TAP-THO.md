# Bài tập thở trong CRM

Nút 🌿 Bài tập thở ở thanh trên mở một hộp thoại, không chuyển trang hoặc thay đổi bản nháp đang nhập. Trên điện thoại nút giữ biểu tượng và nhãn trợ năng. Đóng, Escape, chuyển tuyến, Back/Forward hoặc đăng xuất sẽ tháo toàn bộ iframe để dừng nhạc và animation. Không lưu lịch sử tập, không chấm điểm và không gọi API.

Mặc định: thở nhẹ văn phòng, 1/2/5 phút. Wim Hof là lựa chọn riêng, giữ hơi tự nguyện, có hướng dẫn bắt buộc trước khi bắt đầu và nút dừng ngay. Có đủ 5 bản nhạc của demo v13, không tự phát. Các audio và ảnh được phục vụ cùng CRM, không phụ thuộc quyền truy cập Site demo. Giữ nguồn và giấy phép trong giao diện. Dreams Become Real được nén lại MP3 128 kbps để phù hợp giới hạn truyền tệp, không thay đổi nội dung hoặc thời lượng.

## Kỹ thuật

`breathing-launcher.js` tải HTML tĩnh cùng nguồn và gắn vào iframe srcdoc; không thay X-Frame-Options/CSP của CRM. Chỉ tải HTML do repo sở hữu, không nhận URL/HTML từ người dùng. Mọi JS/CSS đặt ở gốc trial-ui để được bộ stamp-ui-version hiện có quản lý phiên bản. Asset nhị phân giữ trong breathing-assets, mỗi tệp dưới giới hạn 25 MiB của Cloudflare Pages. Không có migration hoặc credential.

## Kiểm chứng

- 12 regression unit/static checks: mở/đóng, kết quả tải muộn, logout, navigation, Back/Forward, pagehide, lỗi tải, 5 audio, mặc định nhẹ và cổng hướng dẫn Wim Hof.
- Strict TypeScript kiểm tra file test và Node syntax của các module: đạt.
- Chưa chạy toàn bộ repository test suite tại máy này: chỉ dựng bản UI với tệp liên quan từ main a9537b0.
- Browser automation cục bộ chưa chạy: Chromium không tạo được socket trong executor; browser cloud không tới localhost của executor. Không coi fixture unit là bằng chứng layout/phát nhạc thực tế. Test script desktop/mobile riêng được lưu trong gói bàn giao, chưa đạt.
- Cần kiểm tra trên CRM đã triển khai: nút 1440/390px, mở/đóng nhanh, đổi bài, phát/dừng cả 5 nhạc, đóng khi đang giữ hơi, đổi tab, đăng xuất, và giữ nguyên bản nháp. Cần nghe thử trên thiết bị và iOS thật.

## Phát hành/rollback

Thay đổi UI-only. Giữ quy trình CI/deploy hiện có, không bỏ gate và không thay workflow. Rollback bằng revert commit UI; không cần đổi dữ liệu. Không triển khai khi CI chưa đạt hoặc browser QA chưa giải quyết.
