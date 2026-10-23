# Nhắc lịch nhận hàng lúc 08:00 Việt Nam

- Workflow deploy API cài/thay job `receiving-reminders-0800-vn` sau khi deploy endpoint thành công. `*/15 1-16 * * *` theo UTC bắt đầu lúc 08:00 Asia/Ho_Chi_Minh và rà soát lại mỗi 15 phút tới 23:45 để phục hồi lỗi tạm thời hoặc hẹn nhận được thêm/sửa sau 08:00. Khoá duy nhất bảo đảm không nhắc lặp. SQL dừng nếu cron.timezone khác UTC/GMT hoặc thiếu token máy chủ trong Vault.
- Chỉ dùng pg_cron/pg_net và `sapo_sync_token` trong Vault đã có. Không thêm bảng, extension, quyền, không sửa job Sapo/GHN. Không đưa mã bí mật vào trình duyệt hoặc nội dung job.
- Endpoint POST `/api/staff/integrations/tasks/receiving-reminders` dùng auth integration máy chủ sẵn có. Cookie nhân viên, kể cả Manager, không thay thế được token.
- Mỗi đơn mua/ngày hẹn/NCC hoặc phiếu lấy trước/NCC/ngày lấy tạo một việc cho từng Manager, Sale Admin, Kho còn hoạt động. Hạn là ngày nhận, giờ 08:00. Mỗi người thấy việc của mình trong Công việc hôm nay. Việc không bị người khác bấm nhận làm biến mất khỏi danh sách của mình.
- Ngày hẹn từng mã ưu tiên hơn ngày chung của đơn. Phiếu nháp, phần đã từ chối, đơn huỷ, hàng nhận đủ không sinh nhắc. Phiếu lấy trước và đơn mua vẫn là chứng từ riêng, không cộng lại tồn.
- Lượt chạy trùng (cron hoặc mở Công việc) dùng auto_key duy nhất nên không tạo trùng. Nếu cron bị gián đoạn, mở Công việc sau 08:00 cùng ngày vẫn bổ sung được. Không tạo hàng loạt việc cho các hẹn quá hạn trước triển khai. Việc đã sinh mà chưa nhận vẫn giữ thành quá hạn ngày hôm sau; nhận đủ, huỷ hoặc dời ngày hẹn tự đóng việc cũ.
- Đổi ngày hẹn: việc mới chỉ sinh khi tới 08:00 của ngày mới. Không lặp nhắc hàng ngày. Nếu một người bị khoá/xoá thì không sinh việc mới cho họ.
- Công việc nhận hàng tự hoàn thành theo chứng từ; không cho hoàn thành/huỷ bằng tay. Ghi nhận hàng ở đơn mua.

Kiểm tra sau deploy (không in token):

```sql
select jobname, schedule, active from cron.job where jobname='receiving-reminders-0800-vn';
select status, return_message, start_time, end_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='receiving-reminders-0800-vn')
order by start_time desc limit 5;
select assignee_id, due_date, due_time, status, title from tasks
where auto_key like 'receiving-due:%' order by created_at desc limit 20;
```

`cron.job_run_details` chỉ xác nhận đã xếp HTTP request. Cần kiểm tra response của pg_net hoặc log Edge Function để xác nhận HTTP 200, và đối chiếu các việc ngày đến hẹn. Chưa xem log lần chạy 08:00 thì không kết luận lịch đã chạy thành công trên production.
