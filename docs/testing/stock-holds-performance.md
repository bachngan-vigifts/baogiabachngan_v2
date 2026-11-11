# Truy vấn giữ hàng và yêu cầu dồn — 11/11/2026

## Kết luận và phạm vi

Query ID `-4778443033376470974` trong snapshot `pg_stat_statements` đúng là truy vấn legacy của `orderHolds()`, trước sửa tại `src/modules/sales/api/hold-routes.ts:66`. Snapshot đầu: 4.295 calls, mean 23,586 ms, max 1.811,274 ms, 13.230.542 shared hits, không physical reads/temp spills. Query ID không phải bằng chứng đủ để nối một log lịch sử với SQL hiện tại.

**Hai thông tin cần đính chính từ log gốc:**

- Auto-explain lúc **07:33:34 ngày 10/11 giờ Việt Nam** (`00:33:34 UTC`) có duration **11.115,620 ms**, ghi cùng ID, nhưng SQL chứa `product_prices`, **không có `sales_order_lines` hoặc `stock_moves`**. Trong snapshot hiện tại, truy vấn danh mục/giá có ID `4635181618632353283`, mean 726,669 ms, max 12.457,224 ms. Không gán lần 11,1 giây cho truy vấn giữ hàng. PR #613 đang sửa phần scan danh mục riêng.
- Hai cặp Supavisor lúc **11:44:01 và 12:11:52 ngày 10/11 giờ Việt Nam** (`04:44:01` và `05:11:52 UTC`) đều là **info**, “No subscribers … shutting down” rồi “shutting down gracefully”. Chúng không chứng minh chạm giới hạn client. Không suy ra phải tăng pool từ các sự kiện này.

Mọi thao tác production trong công việc này chỉ đọc: thống kê/log, SELECT đối chiếu, EXPLAIN trong transaction READ ONLY, statement_timeout 8s. Không sửa compute, pool size, pooler URL, DDL, migration, RLS hoặc dữ liệu. Không ghi thông tin khách, URL có token, secret hay connection string vào báo cáo. Các thay đổi ứng dụng ở branch riêng, chưa merge/deploy.

## Nơi gọi và màn hình

Dấu SQL đang điều tra có warehouse filter nhưng không có danh sách SKU hoặc storeScope. Chuỗi gọi khớp là:

1. `trial-ui/pos.js:refreshStockSnapshot()` gọi GET `/pos/stock-snapshot`.
2. `src/modules/sales/api/pos-routes.ts:831` kiểm quyền POS và quyền quầy rồi gọi `posStockSnapshot()`.
3. `src/modules/sales/api/pos-stock-snapshot.ts:56` gọi `reservedBySku(db, undefined, register.warehouseId)` trong bản đọc nhất quán.
4. `src/modules/sales/api/pos-store.ts:213` gọi `orderHolds(db, skus, warehouseId, undefined, true)`.
5. `hold-routes.ts:66` chạy phần legacy, nay chuyển vào `legacy-order-holds.ts:12`.

Các caller khác của `reservedBySku` truyền tập SKU; các caller trực tiếp `orderHolds` khác không có warehouse hoặc có SKU/storeScope. Đây là bằng chứng về **luồng tải tồn POS**, không phải kết luận màn hình danh sách đơn CRM chạy truy vấn này. Helper vẫn được dùng chung cho kiểm tồn, giữ hàng, xuất kho, chuyển đổi giữ hàng và đơn/HĐKT; các biến thể đó được kiểm thử hồi quy. Không có span request→SQL để gán từng call lịch sử cho một người dùng/màn hình cụ thể.

## Plan và bản sửa

Plan cũ dùng `idx_stock_moves_card` theo `(sku,warehouse_id)`, `idx_packing_slips_order`, `idx_deliveries_order`, `idx_sales_order_lines_order` và `uq_stock_moves_ref`. Vấn đề đã thấy:

- Cùng tổng net issue xuất hiện ở SELECT và HAVING: mỗi aggregate chạy 32 lần ở mẫu đầu, tổng 64 lần.
- Kiểm tra ledger/opening bị lặp; node kiểm opening có 925 loops trong mẫu đầu.
- Phần warehouse fallback theo ca/quầy cũng là scalar subquery; bản sửa này giữ nguyên quy tắc đó.

`legacy-order-holds.ts` gom các dòng đủ điều kiện theo **order + SKU**, gom ledger references và warehouse đã mở sổ một lần, join packing/POS-delivery moves rồi cộng net issue một lần. CTE materialized giữ aggregate khỏi bị PostgreSQL tính lại khi planner đánh giá thấp số dòng. Hai nhánh reference dùng UNION ALL: `ref_type` loại trừ nhau; không nhân move theo số dòng trùng SKU.

Công thức vẫn là `max(0, SUM(qty) - max(SUM(delivered_qty), max(0, -SUM(net stock_moves.qty))))`. Giữ reverse moves; không cộng số đã giao với số đã xuất; không thêm lọc kind/status phiếu; giữ scope, warehouse không xác định, Sapo/ledger exclusion, nhãn HĐKT, thứ tự và limit 5.000/complete. Phần timed/capped/pending GHN holds không thay đổi. Không cache tồn hoặc reservation giữa request/giao dịch.

**Chưa có bằng chứng cần index mới.** Index candidate `(sku,warehouse_id,ref_type,ref_id)` có hai cột đầu trùng prefix index card hiện hữu; plan hiện tại đã dùng prefix này, đồng thời có index bắt đầu bằng ref_type/ref_id. Sau gom truy vấn, chưa thấy scan thiếu index cần xử lý. Chưa đo A/B tạo candidate nên không tuyên bố nó nhanh hơn/chậm hơn. Thêm nó sẽ thêm bảo trì entry/WAL/dung lượng trên ghi stock_moves; chưa có lợi ích đã đo để bù chi phí đó. Không tạo migration/index.

## Số đo trước/sau

Năm phép EXPLAIN ghép cặp, đổi thứ tự before/after, hai nhánh trong **cùng statement/snapshot**, dữ liệu thật chỉ trả plan và số lượng:

| Lượt | Cũ (ms) | Mới (ms) | Shared hits cũ → mới | Số dòng mỗi nhánh |
|---|---:|---:|---:|---:|
| 1 | 8,554 | 5,080 | 3.104 → 1.063 | 19 |
| 2 | 9,206 | 12,084 | 3.101 → 1.066 | 19 |
| 3 | 8,861 | 3,797 | 3.104 → 1.063 | 19 |
| 4 | 8,213 | 4,572 | 3.216 → 1.097 | 20 |
| 5 | 8,764 | 3,717 | 3.219 → 1.094 | 20 |

Trung vị branch execution **8,764 → 4,572 ms** (giảm 47,8%); block visits giảm xấp xỉ **66%**. Thời gian là `Actual Total Time` của nhánh EXPLAIN, không gồm planning/network/API queue, không phải p95 trang hoặc số đo sau deploy. Có một lượt mới chậm hơn cũ. Dữ liệu có phát sinh thêm đơn giữa các lượt, nhưng hai nhánh từng lượt dùng chung snapshot.

Các phép đo riêng trước đó dao động lớn: kho có holds, cũ 11,795–102,419 ms, mới 6,803–461,395 ms; không bỏ outlier để tuyên bố tăng tốc toàn hệ thống. Kho còn lại không có dòng legacy: median 1,275 → 1,230 ms, cùng 217 shared hits. Đối chiếu **EXCEPT ALL hai chiều** cùng snapshot: kho thứ nhất 19/19 dòng, 0 khác biệt; kho thứ hai 0/0 dòng, 0 khác biệt.

Dữ liệu tổng hợp và giới hạn đo: [stock-holds-performance-evidence.json](stock-holds-performance-evidence.json).

## Burst, retry và vòng đời kết nối

Log 11:40–12:16 ngày 10/11 giờ Việt Nam (`04:40–05:16 UTC`) có 130 slow logs, dbMode **direct**, inflight tối đa **10**. POS customers lên tới 26 GET thành công/phút; stock snapshot 11 slow logs, max 4.258 ms, tối đa 39 business queries. Có request GHN pull tới 78.461 ms/165 queries và nhiều route khác chậm. Không dùng một truy vấn giữ hàng 23,6 ms để giải thích toàn bộ các đuôi dài này.

Gateway có 2.376 records gồm **1.124 preflight 204**: không được đếm tất cả là business DB requests. Không thấy 503 trong cohort này; có một 502. Không đủ bằng chứng nói retry gây ra sự cố cụ thể. Cũng không có bằng chứng app tạo pool mới cho từng query: lifecycle hiện chia sẻ client cho các request/background đang chạy, direct max1 và đóng khi hết người dùng; pooler/canary là client tách có chủ đích. Snapshot session sau sự cố không loại trừ burst trước đó.

Hai vấn đề có thể tái hiện từ code đã được giới hạn:

- **Autocomplete POS:** debounce 100 ms nhưng tìm mới vẫn gửi trong lúc tìm cũ chưa xong. `latest-read.js` giữ một logical request đang chạy và chỉ tìm đầu vào mới nhất sau đó. Thử Chromium desktop 1.440px/mobile 390px: mở picker + gõ 4 từ khi request đầu bị giữ → **2 lượt gửi tổng, max1 đồng thời**, kết quả từ cuối đúng, 0 JS errors. Các request trung gian được bỏ; không abort rồi lập tức gửi thêm để mặc server tiếp tục chạy query cũ. Scope queue theo picker; đóng popup vô hiệu hóa lượt chờ. Transport retry bên trong logical request giữ nguyên.
- **Readiness:** trước sửa, một burst fail 5 probes rồi burst kế tiếp/new direct client lập tức bắt đầu 5 probes nữa. `request-lifecycle.ts` thêm **capacity cooldown 1 giây ở isolate** và jitter 0–25% cho backoff, vẫn tối đa 5 probes/đợt, không tăng số kết nối. Kiểm thử 30 callers chung client rồi 30 client thay thế trong cooldown chỉ có **5 probes**, thay vì có thể bắt đầu đợt retry mới. Hết cooldown phục hồi ngay; lỗi không phải capacity không được cache/retry thêm. Đây là kiểm thử failure injection, không phải số đếm retry production đã quan sát.

PR này bổ sung cho #613; không sửa các file preload brand predicate, public auth-config hay scheduler của PR đó. Regional fallback/transport retry budgets, login/auth, cron, Sapo và các luồng GHN/SePay không đổi.

## Kiểm chứng và triển khai

- **97 tests pass**, 0 fail: giữ hàng báo giá/đơn/HĐKT, kho riêng/quyền nhân viên, xuất từng phần/hoàn, 5.001 legacy holds, POS UI/chọn khách, regional/transport retry, lifecycle và architecture.
- Test mới so truy vấn cũ/mới với **30 tổ hợp** SKU/warehouse/owner scope trên PGlite; có dòng trùng mã, reverse, nhiều kho, nhiều reference type, orphan reference, Sapo/ledger, trạng thái đơn/HĐKT. Kiểm plan PGlite xác nhận hai aggregate materialized chạy tối đa một lần.
- `npm run typecheck`, `npm run ui:build`, `git diff --check` pass. Chromium desktop/mobile như trên.
- Chưa merge/deploy; do đó **chưa có số đo latency trang production sau phát hành**. Sau review/CI, deploy API rồi UI theo workflow hiện có, theo dõi p50/p95/503, số business requests (loại OPTIONS), inflight và query mới trên cùng cohort route/vùng; không dùng pg_stat cũ/new có thời gian tích lũy khác nhau như A/B.
- Rollback: revert commit ứng dụng rồi chạy API/UI workflow thông thường. Không có migration hoặc dữ liệu cần rollback. Nếu phát hiện thay đổi lượng giữ, dừng phát hành và đối chiếu cùng snapshot trước khi tiếp tục.
