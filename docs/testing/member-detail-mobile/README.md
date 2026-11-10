# Hồ sơ nhân viên trên mobile

Các bảng liên quan trong hồ sơ nhân viên bị chồng quy tắc mobile: ép về bảng rộng nhưng vẫn giữ kích thước ô từ bố cục thẻ. Tên khách bị bóp thành cột rất hẹp.

Sửa riêng sáu tab khách hàng, báo giá, đơn hàng, HĐKT, phiếu thu và công nợ: tên bản ghi chiếm cả hàng, thông tin còn lại có nhãn theo cột. Thanh tab cuộn bên trong thẻ và giữ tab được chọn trong tầm nhìn. PC giữ bảng; không đổi API, dữ liệu, phân quyền, ngày công hay bảng lương.

## Kiểm tra

- Chromium/Playwright với router CRM thật và dữ liệu tổng hợp trong PGlite, chặn mạng bên ngoài; không dùng hay sửa dữ liệu production.
- Đạt cả 8 tab ở chiều rộng 320, 360, 390, 430, 768, 850 và 1440 px. Kiểm tra không tràn trang, ô dữ liệu không thoát thẻ, tên dài đọc được, tab đang chọn nhìn thấy.
- Manager xem nhân viên; nhân viên xem chính mình, không có thao tác tính lương; nhân viên khác bị API từ chối 403. Liên kết khách hàng mở đúng hồ sơ. Không có lỗi JavaScript hoặc browser request ghi dữ liệu.
- Chạy: `node --import tsx scripts/testing/member-detail-mobile.mjs after`. Có thể đặt `PLAYWRIGHT_MODULE` và `MEMBER_UI_DIR`; Chromium ở `/usr/bin/chromium`.
- `npm run typecheck`, `npm run ui:build`.

## Tốc độ

Ba lần tải mới mỗi kích thước, cùng dữ liệu và điều kiện mạng: latency 40 ms, download 1.6 MB/s. Trước dùng giao diện commit d4533b58, sau dùng bản sửa. Median (ms):

| Viewport | Dữ liệu sẵn sàng trước/sau | Load trước/sau | FCP trước/sau | LCP trước/sau | CLS trước/sau |
|---|---|---|---|---|---|
| 1440 | 3231 / 3236 | 3123 / 3147 | 572 / 588 | 2972 / 2964 | 0.00065 / 0.00065 |
| 430 | 3090 / 3114 | 3055 / 3083 | 580 / 612 | 580 / 612 | 0.07779 / 0.07779 |

Số request JS giữ 164, API mở trang giữ 16; dung lượng JS tăng 618 byte. Sai khác thời gian nhỏ trong phép đo local; không suy ra tốc độ production. TTFB trong JSON là HTML do máy local phục vụ, không phải độ trễ Supabase. File results.json lưu từng lần đo và median.
