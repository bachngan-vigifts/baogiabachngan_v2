# Kế toán: đối chiếu sao kê và tóm tắt cuối ngày

## Đối chiếu sao kê (trang Công nợ › nút "Đối chiếu sao kê")

1. Bấm **Tải file mẫu**. File có 2 trang:
   - **Sao kê:** các cột Ngày giao dịch · Số tiền ghi có (VND) · Nội dung chuyển khoản · Mã giao dịch ngân hàng · Tên người chuyển.
   - **Hướng dẫn:** cách điền từng cột.

   Có thể dùng thẳng file Excel ngân hàng xuất, nếu file có các cột Ngày / Ghi có / Diễn giải (Mô tả) / Số tham chiếu.
2. Chọn file (.xlsx, .xls hoặc .csv). Hệ thống chỉ lấy các dòng **tiền vào**, rồi ghép với công nợ đang còn phải thu:
   - **Ghép chắc:** nội dung chuyển khoản có số đơn hoặc số HĐKT. Hệ thống bỏ dấu, khoảng trắng và gạch dưới khi so, nên "DH 20261020 005" khớp với "DH_20261020_005". Dòng này được **chọn sẵn**.
   - **Gợi ý:** không có số chứng từ, nhưng số tiền đúng bằng số còn nợ (hoặc số quá hạn) của **duy nhất** một đơn. Dòng này **không chọn sẵn**; kiểm tra tên người chuyển rồi mới tick.
   - **Xử lý tay:** không khớp, nội dung nhắc nhiều đơn, số tiền vượt số còn nợ, hoặc trùng dòng trong file.
3. Bấm **Ghi thu các dòng đã chọn**. Mỗi dòng thành một phiếu thu "Chuyển khoản", ngày thu theo sao kê, số chứng từ là mã giao dịch kèm nội dung.
   - Mã chống lặp tính từ mã giao dịch + ngày + số tiền + đơn. Tải lại cùng file (hôm sau, máy khác) cũng **không ghi thu lần hai**.
   - Lỗi ở từng dòng (ví dụ két chưa mở ca, đơn đã thu đủ) hiện ngay trên dòng đó; các dòng khác vẫn ghi bình thường.

Code: `trial-ui/bank-statement.js` (đọc file, ghép, mã chống lặp), `trial-ui/app.js` (hộp đối chiếu). Test: `tests/app/bank-statement-ui.test.ts`.

## Tóm tắt cuối ngày (gửi Manager lúc 18:00)

- **Nội dung:**
  - thu khách theo hình thức (chuyển khoản / tiền mặt / khác);
  - trả NCC;
  - tiền vào / ra két;
  - hoá đơn đã xuất trong ngày và đang chờ xuất;
  - nợ quá hạn đang theo dõi;
  - kỳ trả NCC sắp đến hạn.
- **Cách nhận:** thông báo trong chuông và Web Push cho Manager đang hoạt động. Trang Việc kế toán có dòng "Hôm nay" cùng số liệu.
- **Endpoint lịch chạy:** `POST /api/staff/integrations/accounting/daily-summary`, dùng token máy chủ. Mỗi ngày chỉ gửi **một lần**; chạy lại không gửi trùng.
- **Endpoint xem trên trang** (Kế toán / Manager): `GET /api/staff/tasks/accounting/daily?date=YYYY-MM-DD`.
- **Chỉ đọc số liệu.** Không thêm bảng, không cần migration.

### Cài lịch (anh chạy tay sau khi deploy API)

Chạy `supabase/accounting-daily-summary-cron.sql` trong SQL editor của Supabase. Lịch `*/15 11 * * *` theo giờ UTC chạy lúc 18:00, 18:15, 18:30 và 18:45 giờ Việt Nam. Ba lượt sau chỉ để bù khi lượt đầu lỗi; endpoint không gửi lần hai trong ngày. Lịch dùng pg_cron/pg_net và token `sapo_sync_token` đã có trong Vault, không đụng job Sapo / GHN / nhắc nhận hàng.

Kiểm tra (không in token):

```sql
select jobname, schedule, active from cron.job where jobname='accounting-daily-summary-1800-vn';
select status, return_message, start_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='accounting-daily-summary-1800-vn') order by start_time desc limit 5;
```

Muốn tắt: `select cron.unschedule('accounting-daily-summary-1800-vn');`
