# Đo hiệu năng Trang chủ

Đo Chromium với API/router CRM thật, Postgres test cô lập; không dùng dữ liệu production. Mỗi bước đo **3 lần cho mỗi viewport 1440×1000 và 390×1000**, lấy trung vị. Mỗi lần dùng browser context mới, cùng latency 40 ms và băng thông tải 1.600.000 byte/s. Không chạy bộ test DB khác trong lúc đo.

Mốc trước sửa là trang mặc định Báo giá của Manager; các bước sau là Trang chủ. Nội dung hai trang khác nhau, nên số đo phản ánh chi phí mở app/điểm vào, không phải benchmark cùng một màn hình. TTFB trong bảng là tài liệu HTML của máy chủ test, không phải TTFB Supabase production. JS đo từ `encodedBodySize` trên máy chủ test không nén; không suy ra dung lượng truyền của Cloudflare production.

| Bước | Viewport | Sẵn sàng (ms) | Load (ms) | TTFB (ms) | FCP (ms) | LCP (ms) | CLS | API lúc mở | JS (KB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Trước sửa (Báo giá) | 1440 | 3436 | 2886 | 8 | 632 | 3096 | 0.0024 | 13 | 2368.9 |
| Trước sửa (Báo giá) | 390 | 3428 | 3114 | 5 | 664 | 3296 | 0.0355 | 13 | 2368.9 |
| Bước 1: route và khung Home | 1440 | 3288 | 2924 | 4 | 668 | 3300 | 0.0022 | 8 | 2370.7 |
| Bước 1: route và khung Home | 390 | 3186 | 2910 | 6 | 648 | 3196 | 0.0131 | 8 | 2370.7 |
| Bước 2: dữ liệu thật | 1440 | 3439 | 2974 | 7 | 680 | 3464 | 0.0022 | 9 | 2371.9 |
| Bước 2: dữ liệu thật | 390 | 3348 | 3007 | 5 | 640 | 3360 | 0.0406 | 9 | 2371.9 |
| Bước 3: giao diện hoàn chỉnh | 1440 | 3429 | 2907 | 5 | 660 | 3420 | 0.0059 | 9 | 2391.8 |
| Bước 3: giao diện hoàn chỉnh | 390 | 3181 | 2872 | 4 | 628 | 3172 | 0.0022 | 9 | 2391.8 |

Sẵn sàng: mốc trước sửa chờ API danh sách Báo giá trả lời và một nhịp render; sau sửa chờ Home render snapshot công việc. Theo dõi thêm 1,8 giây sau mốc này để lấy paint/CLS, số request và dung lượng trong cùng cửa sổ quan sát. API chờ duyệt/thông báo có thể hoàn thành sau nội dung chính và được bố trí vùng tải riêng. Các request nền ngoài cửa sổ này không nằm trong số đếm trên.

Bản hoàn chỉnh giữ số API khởi động thấp hơn mốc ban đầu; không tải full quotes/customers/members/catalog ở Home, không kéo lại các danh sách này khi nhịp cập nhật Home chạy. Tăng JS chỉ là module Home và feed nhỏ; không thêm thư viện hay biểu đồ. Không dùng số liệu này để khẳng định tốc độ trên điện thoại/mạng thật.

Kết quả chi tiết và ảnh ở `/tmp/crm-home-{baseline,step1,step2,release}/results.json`, kiểm tra luồng ở `/tmp/crm-home-flows/flows.json`. Chạy lại bằng `node --import tsx scripts/testing/home-browser.mjs release` trong môi trường có Playwright/Chromium. Khi triển khai, kiểm tra asset/route trên CRM thật; cần phiên đăng nhập thực để đo trang chủ production tương đương.

Kiểm tra CLS đã tìm được phần dịch chuyển chủ yếu là `.main::after` (vùng chừa chỗ cho chat) và header đổi bố cục khi CSS Home đến muộn. Giữ chiều cao Home và bố cục header bằng CSS tối thiểu có sẵn từ đầu làm CLS mobile giảm từ khoảng 0,093 xuống 0,0022. Không giấu phần tử khỏi phép đo hoặc thay công thức đo.

Đánh giá: mốc sẵn sàng PC gần như giữ nguyên (3,44 → 3,43 giây), mobile giảm (3,43 → 3,18 giây). LCP PC cao hơn mốc Báo giá trống (3,10 → 3,42 giây), cần đọc trong bối cảnh màn hình Home có nội dung khác và module tải theo nhu cầu; không kết luận mọi chỉ số đều nhanh hơn. FCP/CLS và số API được báo riêng ở bảng trên.
