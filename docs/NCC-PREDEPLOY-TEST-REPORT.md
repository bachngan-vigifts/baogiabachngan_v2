# Kiểm thử bổ sung cổng NCC trước triển khai

Ngày 12/11/2026 (giờ Việt Nam). PR nháp: [#638](https://github.com/bachngan-vigifts/baogiabachngan_v2/pull/638).

## Phạm vi và kết luận

Kiểm tra form đăng nhập/cổng phiếu xin hàng **hiện có** bằng trình duyệt và router/PGlite; kiểm tra bản thiết kế 10 trang bằng dữ liệu giả. Không dùng dữ liệu production, không gửi email thật, không gọi vận chuyển/Sapo, không ghi tiền hay sổ kho production. Chưa merge/deploy.

Bộ này xác minh các phần đã có trong PR. Không coi mô hình minh họa là backend mới đã hoàn tất. Các API đơn mua, tồn riêng NCC, hóa đơn, tạm ứng và điều chuyển cần được thiết kế/triển khai, kiểm tra quyền và đối chiếu số liệu theo từng đợt sau khi giao diện được duyệt; xem `NCC-WORKSPACE-REVIEW.md`.

## Các lỗi/điểm yếu được tái hiện và sửa

| Trường hợp | Sửa trong phạm vi PR | Bằng chứng kiểm tra lại |
|---|---|---|
| API trả HTML thay JSON: login hiện thông báo parse kỹ thuật; 401 từ danh sách chưa đóng workspace | `trial-ui/supplier-portal.js`: xử lý status độc lập với JSON; thông báo dễ hiểu; 401 đưa về form và ẩn nội dung nghiệp vụ | HTML 503, HTML 401, response thành công nhưng sai định dạng; không tự gửi lại POST |
| Challenge chống bot đã dùng sau login hoặc quay lại form do phiên hết hạn | Reset widget sau login thành công và khi mở lại form; không đổi xác thực backend | Hết hạn challenge bị máy chủ giả chặn; quay lại đăng nhập có challenge mới; thử lại sau lỗi đúng token |
| Giá trị ngày lấy từ URL có thể tạo thuộc tính HTML trong bản duyệt | Escape các thuộc tính ngày, chỉ định dạng chuỗi ngày đúng mẫu; CSV chặn công thức sau khoảng trắng/control whitespace | Payload ở from/to/asOf không tạo được thuộc tính; kiểm tra CSV công thức vẫn là text |
| Thông báo “xem trước hợp lệ” còn giữ khi người dùng thay số tiền/nguồn | Xóa kết quả khi input/change và trước mỗi submit | Sửa số tiền sang vượt hạn không còn thông báo thành công cũ |
| Bộ lọc khôi phục từ URL bị mất sau reload rồi sang trang khác và quay lại | Lưu trạng thái đã đọc từ URL vào bộ nhớ từng trang | Status còn nguyên sau reload/chuyển trang; điều hướng nhanh không ghi đè bằng debounce cũ |
| Ledger mẫu duyệt toàn bộ khoản thanh toán lại cho từng đơn | Gom khoản thanh toán/giảm trừ theo orderId một lần; trang không cần công nợ không tính ledger | 10.000 đơn + 20.000 khoản thanh toán: tổng còn thu vẫn 800.000.000 ₫; khoảng 2.102 ms trước, 65 ms sau trong một phép đo local cùng dữ liệu |

Số đo trên là **mô hình JavaScript của bản duyệt**, không phải EXPLAIN/đo tải PostgreSQL production hoặc cam kết thời gian API thật. Cần đo API/database riêng khi nối dữ liệu.

## Ma trận kiểm tra local

| Nhóm | Kết quả và nội dung |
|---|---|
| 30 tình huống bất lợi — `scripts/testing/supplier-failure-scenarios.mjs` | Email/password không hợp lệ; login mất mạng/429/503 HTML/200 sai định dạng; phiên lưu còn/hết hạn; Manager chỉ xem; chặn nhân viên; thiếu mapping NCC; challenge hết hạn/config lỗi; logout thành công/thất bại; storage bị chặn; quên mật khẩu đúng audience và chống gửi lặp; xác nhận NCC hai lần/mất mạng/401/409; tên sản phẩm là text; payload URL; thay nội dung form; đổi trang nhanh; giữ filter; ID lạ; màn hình nhỏ/ngang |
| 5 kịch bản login — `scripts/testing/supplier-login-review.mjs` | 390/1280 px, Turnstile bật/tắt, sai rồi thử lại, gửi lặp, hiện mật khẩu, reset challenge sau sử dụng, role không hợp lệ |
| 40 lượt trang — `scripts/testing/supplier-workspace-review.mjs` | 10 trang × 360/390/768/1440 px; không tràn ngang; bảng/thẻ; lọc từng select, ngày/tiền sai; rỗng; phân trang; CSV theo bộ lọc; chi tiết; phím Tab/Escape; tạm ứng vượt tiền; menu mobile |
| 20 lượt bản HTML độc lập — `scripts/testing/supplier-review-portable.mjs` | 10 trang × 390/1440 px, tải một file HTML qua localhost, form đăng nhập chỉ xem thử; không tải tài nguyên ngoài hoặc gửi tài khoản |
| 4 lượt browser/router thật — `scripts/testing/supplier-navigation.mjs` | Manager/NCC × 390/1280 px; NCC không gọi API sản phẩm/đơn mua nội bộ; Manager xem chi tiết/điều hướng; chỉ đọc dữ liệu PGlite |
| 67 test hồi quy liên quan | Kiến trúc, area/role, auth lifecycle/cookie/session, phiếu xin hàng/giao một phần/tách phiếu, chi tiết NCC, forgot-password, UI sinh tự động |
| 18 test mới được CI chuẩn phát hiện | 17 ca mô hình và 1 ma trận router quyền NCC. Scope hai NCC, ngày chốt, thanh toán/credit trùng/hủy/future, không cộng hóa đơn/phiếu giao/đề nghị vào tiền đã nhận, null/0, CSV, dữ liệu lớn |
| TypeScript / build | Chạy `npm run typecheck`, `npm run ui:build` với dependency riêng của worktree theo package-lock; không dùng node_modules thay đổi từ worktree khác |

Ma trận router mới (`tests/app/supplier-portal-boundary.test.ts`) kiểm tra trực tiếp ID phiếu thuộc NCC khác, giả supplierId qua URL/body, truy cập API nội bộ, không đăng nhập, role sai, phản hồi lặp, thay phản hồi gây 409, NCC bị ngừng hoạt động, tài khoản bị khóa và role Manager lệch nhưng position supplier. Đếm `supplier_payments`, `supplier_receipts`, `stock_moves` trước/sau: phản hồi không tạo chứng từ tiền/kho.

Hai file `tests/app/supplier-portal-boundary.test.ts` và `tests/app/supplier-workspace-review.test.ts` được `npm test`/CI hiện hành tự phát hiện; không sửa workflow, luật kiến trúc hoặc migration.

## Cách tái chạy

```bash
npm ci
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/supplier-portal-boundary.test.ts tests/app/supplier-workspace-review.test.ts
node --test scripts/testing/supplier-workspace-model.test.mjs
```

Các script browser dùng Playwright/Chromium của môi trường kiểm thử; truyền `PLAYWRIGHT_MODULE` nếu Playwright nằm ngoài dependency của repo. Báo cáo JSON/ảnh được xuất theo `SUPPLIER_REVIEW_DIR`.

## Những điều chưa được xác nhận để triển khai thật

- Chưa kiểm thử E2E các API mới chưa được xây; các nút trong bản duyệt không ghi dữ liệu thật.
- Chưa đối chiếu công nợ mẫu với số dư production; chưa xác minh dữ liệu hóa đơn/ánh xạ tồn NCC/điều chuyển production. Không đề nghị tự backfill theo dữ liệu minh họa.
- Kiểm thử forgot-password xác minh luồng, trạng thái và chống gửi lặp; **không chứng minh email production tới hộp thư NCC**.
- CI phải được kiểm tra trên đúng HEAD mới của PR trước merge. Không dùng kết quả xanh của commit trước để khẳng định commit sau đã qua CI.
- Giữ PR nháp và chờ duyệt giao diện; mỗi đợt nối API có kiểm thử quyền/đối chiếu riêng. Không tự triển khai chỉ vì bộ ảnh hoặc test prototype đạt.
