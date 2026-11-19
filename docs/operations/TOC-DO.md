# Tốc độ tải trang CRM

## POS và vùng Edge (04/11/2026)

- Production: CSDL ở Seoul (`ap-northeast-2`); phần lớn lượt POS chậm chạy tại Singapore. Log gần 24 giờ ghi nhận trung vị options 5,12 s tại Singapore / 2,42 s tại Seoul; catalog 3,77 s / 0,57 s; orders 2,49 s / 0,64 s. Đây là các nhóm lượt gọi thực tế khác nhau, không phải benchmark A/B cùng điều kiện.
- POS không chờ toàn bộ danh mục/tồn kho trong options nữa. Lấy cấu hình nhẹ, hiển thị 20–60 mã bằng API catalog hiện có rồi tải snapshot ở nền. Fixture trình duyệt với snapshot chậm 3 s kiểm tra cả Lock/Minh Long, điện thoại/máy tính và quét mã trước khi tải nền hoàn tất (`scripts/testing/pos-first-load.mjs`). `POS_BASELINE_REF` cho phép chọn commit gốc để so sánh; mặc định là bản đã triển khai `4291e92`.
- Header chọn vùng vẫn cố định Seoul, không bật lại cơ chế tự học URL cũ. Lỗi mạng/gateway chuyển sang dự phòng 5 phút; sau đó chỉ một GET thăm dò Seoul, các lượt khác vẫn đi dự phòng tới khi thăm dò đạt. Tắt tay được lưu riêng và giữ qua tải lại. Cờ tự tắt v1 không còn giữ máy ở Singapore vô thời hạn.
- GET có chọn vùng thử tối đa một lượt, timeout 8 s, rồi mới dùng luồng đọc dự phòng thông thường. POST/PUT/DELETE không được gửi lại sang vùng khác khi kết quả chưa rõ. Bộ kiểm thử `api-region-request`, `api-region-ui` và `api-transport` bao phủ giới hạn này.

## Đã làm (đợt 1)

| Chỗ chậm | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Mở app / tải lại trang | `_headers` đặt `Cache-Control: no-cache` cho mọi JS / CSS. Mỗi lần mở app, trình duyệt hỏi lại máy chủ từng module (app.js → hàng chục `import` → module con…), từng tầng nối đuôi nhau. | Mọi tham chiếu JS / CSS đều có `?v=<commit>` khi triển khai (`scripts/stamp-ui-version.ts`, nay phủ cả thư viện PDF / Excel / quét mã nạp động). `_headers` cho `*.js` / `*.css` giữ 1 năm (`immutable`). Bản mới = URL mới nên không kẹt bản cũ. `index.html` và file khác vẫn luôn hỏi lại. Test `stamp-ui-version.test.ts` chặn file JS / CSS nào lọt không có phiên bản. |
| Trang đang mở phải chờ | Mở app bắn ~17–20 API cùng lúc (số đếm menu, chuông, nhịp kiểm tra, duyệt, danh sách báo giá / khách dù đang ở trang khác, bản chụp so sánh…). Mỗi bản Edge chỉ có 1 kết nối CSDL (chế độ trực tiếp), nên danh sách của trang đang xem xếp hàng sau các số đếm. | `trial-ui/request-priority.js`: dữ liệu trang đang mở đi trước; lời gọi phụ chờ trang chính xong (tối đa 4 giây), tối đa 3 lời gọi phụ cùng lúc. Danh sách báo giá / khách / nhân viên của trang khác tải sau. Lượt chụp mốc so sánh lúc mở app không đọc lại danh sách vừa tải. Giả lập 1 kết nối, mỗi API 150 ms: trang Két xong 0,74 s thay vì 2,9 s. |
| Phản hồi lớn | Edge phân tích JSON rồi ghi lại (danh mục ~3 MB) chỉ để thêm `sessionToken`. Chỉ nén gzip khi > 100 KB. | Chuyển nguyên văn bản, chỉ sửa JSON khi đăng nhập / đổi phiên. Nén gzip từ 4 KB (danh sách 20–200 KB còn khoảng 1/5). |
| Không biết chậm ở đâu | Không có số đo. | Header `Server-Timing` trên mọi phản hồi API: `db` (chờ kết nối CSDL), `app` (xử lý + số truy vấn), `total`, `region` (vùng chạy Edge). Yêu cầu > 1,5 giây ghi log `API slow` (đã bỏ mã / query string). Menu tài khoản → **Đo tốc độ** tách mạng / máy chủ / CSDL cho từng API, có nút sao chép để gửi. |

## Việc anh cần làm: bật transaction pooler (quan trọng nhất phía máy chủ)

Nếu GitHub **chưa có** secret `SUPABASE_POOLER_URL`: bước "Cấu hình transaction pooler" trong *Triển khai API* luôn bị bỏ qua. Nếu trên Supabase cũng chưa đặt secret `DB_POOLER_URL`, mỗi lần gọi API, Edge phải:
- mở kết nối Postgres mới (TCP + TLS + xác thực);
- chạy thêm `select 1`;
- đóng kết nối ngay sau đó.

Mỗi bản Edge cũng chỉ được 1 kết nối, vì CSDL giới hạn 60 kết nối (sự cố 26/10, xem `API-CONNECTION-RECOVERY.md`). Không nới giới hạn này.

Pooler (Supavisor, chế độ transaction) giữ kết nối sẵn. Mỗi bản Edge dùng tối đa 3 kết nối mà không làm cạn 60 kết nối của CSDL.

1. Supabase → project → nút **Connect** → tab **Connection string** → chọn **Transaction pooler** (cổng **6543**). Copy chuỗi `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:6543/postgres`, thay `[YOUR-PASSWORD]` bằng mật khẩu CSDL.
2. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**: tên `SUPABASE_POOLER_URL`, giá trị là chuỗi trên. Không dán chuỗi này vào chat.
**Tên ở hai nơi khác nhau:** GitHub vẫn là `SUPABASE_POOLER_URL`; workflow chuyển giá trị sang secret **`DB_POOLER_URL`** trên Supabase. Supabase cấm tự tạo tên bắt đầu bằng `SUPABASE_`; dùng tên cũ phía Supabase sẽ bị lỗi `Env name cannot start with SUPABASE_`. Không cần đổi tên hoặc nhập lại secret GitHub đã lưu.

3. Actions → **Triển khai API** → *Run workflow*. Bước "Cấu hình transaction pooler" phải chạy (không còn *skipped*).
4. Kiểm tra `/health` trả `databaseMode: "transaction-pooler"`, sau đó menu → **Đo tốc độ**, cột "Chờ CSDL" phải giảm rõ, thường còn vài ms sau lượt đầu.

## Đọc số đo

- **Chờ CSDL** cao (hàng trăm ms) ở mọi API: do mở kết nối mới mỗi lần. Bật pooler như trên.
- **Máy chủ** cao, **số truy vấn** lớn ở một API: API đó cần gộp truy vấn hoặc thêm chỉ mục. Gửi bảng cho người hỗ trợ.
- **Mạng** cao, máy chủ thấp: do đường truyền / vị trí. Xem cột vùng (`region`). Nếu Edge chạy ở vùng xa CSDL, có thể buộc Edge chạy cùng vùng CSDL (đợt sau).
- Log chậm: Supabase → Edge Functions → `baogia-v2-api` → Logs, tìm `API slow`.

## Đợt 2 – số đo thật (30/10/2026, trước khi pooler có hiệu lực)

Máy anh, 26 lượt gọi: trung vị 2,98 s / lượt. Trong đó máy chủ 1,8 s (chờ kết nối CSDL ~0,85 s, mỗi API 3–16 truy vấn) và mạng ~1 s.

- **Chờ CSDL ~850 ms ở mọi API:** mỗi lần gọi mở kết nối Postgres mới. Pooler (đã đặt secret) sẽ bỏ được phần này.
- **Phần xử lý (máy chủ − chờ CSDL) ≈ 150–200 ms mỗi truy vấn.** Edge chạy ở `ap-southeast-1` (Singapore) nhưng CSDL ở vùng khác: mỗi truy vấn là một chuyến đi xa. Ví dụ `/orders` có 16 truy vấn, phần xử lý mất ~2,2 s.

**Cách sửa:** cho Edge chạy cùng vùng với CSDL (`trial-ui/api-region.js`).
- Edge báo vùng CSDL trong Server-Timing (`dbregion`). Vùng này đọc từ tên máy pooler `aws-0-<vùng>.pooler.supabase.com`, hoặc từ secret `DB_REGION` nếu có.
- Các lượt gọi sau, giao diện thêm `?forceFunctionRegion=<vùng>`. Mỗi lượt chỉ còn một chặng trình duyệt → máy chủ đi xa, thay cho mỗi truy vấn một chặng.
- Ép vùng lỗi (không tới được máy chủ của mình) thì tự bỏ ép vùng.

Kiểm tra sau triển khai: vào **Đo tốc độ**, dòng đầu phải có "vùng máy chủ" trùng "vùng CSDL", và cột "Máy chủ" giảm xuống còn vài chục đến vài trăm ms.

## Kiểm tra URL trước khi bật

Chạy workflow **Kiểm tra kết nối pooler chỉ đọc** trước khi thử triển khai. Workflow chỉ in mã phân loại và hostname pooler công khai từ Supabase, không in URI/mật khẩu/token. Kết quả thành công là `POOLER_CHECK=CONNECTED_SELECT_1`.

Workflow **Triển khai API** cũng chạy `SELECT 1` ở chế độ chỉ đọc trước khi đổi secret hoặc deploy. URL chưa kết nối được sẽ dừng sớm, giữ nguyên cấu hình/API đang hoạt động. Không thử bật lại một URL chưa qua kiểm tra. Nếu cấu hình đã gây 503, workflow **Khôi phục kết nối CSDL trực tiếp** gỡ `DB_POOLER_URL` rồi xác minh health để phục hồi, không chạy migration hoặc đồng bộ hãng vận chuyển.

## Sự cố 30/10/2026 – pooler tạm tắt

Sau khi bật pooler (00:57 UTC), nhiều lời gọi API treo quá 15 giây; nhân viên thấy "Chưa kết nối được máy chủ". Đã chạy **Khôi phục kết nối CSDL trực tiếp** (02:19 UTC); API trở lại bình thường. Ép vùng chạy Edge cũng đã tắt (`REGION_PINNING = false` trong `trial-ui/api-region.js`).

Pooler giờ **chỉ bật khi có biến repository `ENABLE_DB_POOLER = true`**. Secret `SUPABASE_POOLER_URL` vẫn được giữ trên GitHub. Không có biến này thì mỗi lần **Triển khai API** gỡ `DB_POOLER_URL` trên Supabase và dùng kết nối trực tiếp. Chỉ bật lại ngoài giờ làm, khi đã tìm ra nguyên nhân treo và có người theo dõi ngay sau khi bật.

## Máy chủ cạnh CSDL – bật cho mọi máy (30/10/2026)

Thử trên một máy (Manager bật trong **Đo tốc độ**, header `x-region: ap-northeast-2`), 27 lượt gọi, 4G:

| | Trước (Edge ở ap-southeast-1) | Máy chủ cạnh CSDL (ap-northeast-2) |
|---|---|---|
| Trung vị toàn bộ | 2,81 s | **0,83 s** |
| Máy chủ | ~1,98 s | **0,19 s** |
| Chờ CSDL | ~0,85 s | 0,11 s |
| Mạng | ~0,83 s | 0,64 s |

Không lượt nào lỗi → bật mặc định cho mọi máy (`REGION_DEFAULT_ON = true` trong `trial-ui/api-region.js`). Chốt an toàn:

- Vùng cố định, **không tự học** (khác cơ chế `forceFunctionRegion` gây sự cố sáng 30/10).
- Lượt gọi lỗi mạng hoặc phản hồi thiếu Server-Timing → máy đó chuyển về máy chủ mặc định và **giữ tắt** (`localStorage` `bn-api-region-off`), báo "Máy chủ nhanh lỗi kết nối trên máy này". Lệnh đọc tự gửi lại một lần theo máy chủ mặc định; lệnh ghi không tự gửi lại.
- Manager bật lại / tắt trên máy mình trong **Đo tốc độ**.
- **Tắt cho tất cả:** đổi `REGION_DEFAULT_ON` thành `false` rồi deploy giao diện. Mọi máy về máy chủ mặc định, vùng / cờ đã lưu bị xoá.

Sau khi deploy: nhờ vài nhân viên mở app, báo ngay nếu thấy "Chưa kết nối được máy chủ" hoặc "Máy chủ nhanh lỗi kết nối". Nhiều máy cùng báo → tắt cho tất cả như trên.

## Kiểm tra sau nâng Pro – 03/11/2026

Đã xác minh tổ chức `yxflxfjbkhgdlpmdtuvq` dùng Pro; project vẫn ở Seoul (`ap-northeast-2`), PostgreSQL `17.11.0.003`. API trong số đo người dùng cũng ở Seoul. Chưa thay compute, vùng, giới hạn kết nối, global work_mem hoặc bật lại pooler. Probe hiện tại qua transaction pooler chạy được `SELECT 1`, nhưng chưa chứng minh đã hết lỗi treo dưới tải đồng thời ngày 30/10.

Cấu hình bảo trì theo bảng (`20261103094412_crm_catalog_autovacuum.sql`) đã áp dụng production:
- `products`, `product_prices`, `product_stock`: vacuum ở ngưỡng 5% + 50 dòng, analyze ở 2% + 50 dòng, thay vì chờ ngưỡng mặc định lớn hơn.
- `ANALYZE` lại năm bảng sản phẩm, giá, tồn nguồn, số dư và biến động kho. Đọc lại xác nhận autovacuum tự chạy, dead tuples ba bảng giảm về 0. Không VACUUM FULL, không khởi động lại.
- Hoàn tác từng bảng bằng `ALTER TABLE public.<table> RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold)`.

Hai GIN trigram index (`20261103095218_product_search_trigram.sql`) khớp chính xác biểu thức tìm kiếm tiếng Việt và tìm mã bỏ ký hiệu. Production EXPLAIN ANALYZE cho `matchProductWords('lhc3329')` với `active=true`: trước 1.528,028 ms, quét 11.801 dòng; sau 0,983 ms, BitmapOr hai index, đọc hai dòng kết quả. Đây là một mẫu truy vấn đọc, không đại diện thời gian cả trang. API tìm sản phẩm cần giải mã barcode một lần trước khi xây điều kiện để tránh OR subquery khiến planner bỏ qua index. Không thay ý nghĩa tìm kiếm/nhận dạng SKU hoặc quy tắc lọc kho.

Bản sửa API đi kèm giảm dữ liệu đầu vào tính tổng 214 báo giá từ 947.851 xuống 82.019 byte, vẫn dùng `quote-math.ts` để giữ thứ tự phép tính số thực. POS lấy metadata trong cùng truy vấn tồn/giá thay cho truy vấn IN toàn bộ SKU thứ hai. Không lưu đệm tồn dùng khi thanh toán.

`DB_REGION=ap-northeast-2` được khai báo ở workflow triển khai; chỉ giúp báo cáo tốc độ nhận diện vùng CSDL khi API chạy direct mode, không đổi routing. Nâng Pro không tự bật PITR/custom domain. Chưa xác minh được mốc backup gần nhất hoặc compute SKU qua bộ công cụ hiện có; không tuyên bố các mục này đã được cấu hình.

## Đo lại 19/11/2026 – máy CSDL Micro bị nghẽn CPU

- Project không chọn add-on compute nên chạy **Micro** (1 GB RAM, 2 vCPU dùng chung, IO nền 87 MB/s). Phép tính thuần CPU `sum(generate_series(1,2000000))` mất 0,6–0,8 s (máy bình thường ~0,1 s).
- Vì CPU bị giới hạn, quét bảng nhỏ đã nằm trong RAM vẫn chậm: 12k sản phẩm 2,98 s, 72k giá 2 s, 25k tồn 2 s (EXPLAIN ANALYZE). Kết nối 11/60, cache hit 100%, không có truy vấn treo.
- Tìm sản phẩm / khách: chỉ mục trigram theo biểu thức không được chọn (bảng nhỏ), mỗi lần tìm chạy translate() bỏ dấu trên mọi dòng (1,2 s / 0,34–0,58 s). Sửa: cột sinh tự động `search_fold` + chỉ mục trigram (`20261119090000_search_fold_columns.sql`).
- Chuông thông báo: điều kiện "gửi riêng cho tôi" không có chỉ mục phù hợp (1,36 s đọc đĩa). Sửa: `idx_web_notifications_member_created`.
- Việc nên làm phía Supabase: nâng compute lên **Small** (~$15/tháng, 2 GB RAM, IO nền 174 MB/s) hoặc **Medium** (~$60/tháng, 4 GB). Đổi compute khởi động lại CSDL vài phút: làm ngoài giờ bán.
