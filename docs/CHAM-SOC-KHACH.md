# Chăm sóc khách hàng (nhật ký giao dịch CRM)

> **Form "Giao dịch"** (từ migration 0045, theo form CRM đang dùng):
> - Thời gian tạo (ngày).
> - Nhân viên phụ trách: Manager chọn được người khác.
> - Khách hàng\*.
> - Người liên hệ\*: gợi ý từ danh bạ của khách.
> - Nội dung\*.
> - Loại giao dịch\*: Gọi điện thoại / Zalo / Email / Gặp trực tiếp / Báo giá.
> - Doanh số dự kiến.
> - Kết quả\*: Đang tư vấn / Đã gửi báo giá / Đang thương lượng / Đã chốt HĐ / Đã rớt đơn.
> - Chăm sóc lần sau\*.
> - Nhắc tôi trước\*: 1 Tháng / 1 Tuần / 1 Ngày.
>
> Việc nhắc hiện ở Công việc từ ngày *chăm sóc lần sau − nhắc trước* (`remindFrom`, quy tắc `careFollowUps`).

Ghi lại mỗi lần nhân viên trao đổi với khách: gọi điện, Zalo, gặp mặt, đến thăm, email, SMS, ghi chú.
Mỗi lần ghi gồm kết quả và (tuỳ chọn) **lịch hẹn chăm sóc tiếp**.

## Dữ liệu

- **Bảng `customer_activities`**
  - Tạo bảng: migration `0040_customer_care.sql`.
  - Chặn API trình duyệt đọc trực tiếp: `0041_supabase_access_customer_care.sql`.
- **Các cột:**
  - `customer_id` → `sapo_customers` (xoá khách thì xoá theo);
  - `owner_id` → `staff_members` (người ghi, không đổi được);
  - `type`, `result`: danh mục trong `src/modules/care/domain/care.ts` (có CHECK ở DB);
  - `occurred_at` (ISO UTC), `contact_name`, `subject`, `content`;
  - hẹn tiếp: `next_at` (ngày YYYY-MM-DD giờ VN), `next_action`, `next_done_at`;
  - `revision`: chống hai người sửa cùng lúc.

## Quyền

- **Nhân viên:** xem lần mình ghi và đồng nghiệp đang hoạt động cùng nhóm/chức vụ; chỉ sửa/xoá lần mình ghi. Ghi được cho mọi khách hàng.
- **Manager:** xem, sửa, xoá tất cả; lọc được theo nhân viên.
- **Kho, NCC, khách:** không vào được. Menu bị ẩn; API khu vực `business` chặn NCC và khách.
- **Phạm vi chung:** điều kiện `careScope()` trong `src/modules/care/api/routes.ts` dùng chung cho trang Chăm sóc KH và tab "Chăm sóc" ở trang chi tiết khách.

## Luồng

1. **Ghi chăm sóc:**
   - từ trang **Chăm sóc KH** (`#/care`, nút ＋, tìm khách);
   - hoặc từ tab **Chăm sóc** ở trang chi tiết khách (khách chọn sẵn).
2. **Hẹn chăm sóc tiếp:** có hẹn đến hạn (hôm nay hoặc ngày mai) thì máy tự sinh việc **"Chăm sóc lại …"** ở **Công việc** cho người ghi.
   - Việc mở thẳng `#/care/<id>`.
   - Quy tắc `careFollowUps` nằm trong `src/modules/tasks/api/auto-tasks.ts`.
   - Khoá việc là `care:<id>:<ngày hẹn>`, nên dời ngày hẹn sẽ sinh việc mới.
3. **Xong hẹn:**
   - bấm **✓ Xong** ở trang Chăm sóc KH → việc tự hoàn thành;
   - hoặc hoàn thành việc ở **Công việc** → hẹn bên nhật ký cũng xong (`completeFollowUp`).
   - Mở lại hẹn: `POST /care/:id/done {done:false}`.
4. **Huy hiệu menu "Chăm sóc KH":** số hẹn quá hạn + hôm nay.

## API (`src/modules/care/api/routes.ts`)

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/care/config` | danh mục hình thức / kết quả cho giao diện |
| GET | `/care` | `view=log` (mặc định) hoặc `follow-ups`; lọc `q, type, result, customerId, from, to, owner` (`owner` chỉ Manager) |
| GET | `/care/:id` | |
| POST | `/care` | |
| PUT | `/care/:id` | gửi kèm `revision` |
| POST | `/care/:id/done` | |
| DELETE | `/care/:id` | |

## Sửa / mở rộng

- **Thêm hình thức hoặc kết quả:**
  1. thêm vào `CARE_TYPES` / `CARE_RESULTS` và nhãn trong `care.ts`;
  2. `npm run db:generate` (migration cập nhật CHECK);
  3. thêm biểu tượng / màu trong `trial-ui/care.js` (`TYPE_ICON`, `RESULT_TONE`) nếu muốn.
- **Giao diện:**
  - `trial-ui/care.js`: trang và hộp ghi / sửa;
  - tab trên trang khách: mục `care` trong `TABS` của `trial-ui/customer-detail.js`;
  - CSS: khối "Chăm sóc khách hàng" cuối `trial-ui/style.css`.
- **Test:** `tests/app/care.test.ts` (kiểm tra dữ liệu, quyền, lọc, việc tự sinh hai chiều).

