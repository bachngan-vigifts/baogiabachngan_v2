# Bảng Công việc

Trang **Công việc** (`#/tasks`) gom hai loại việc vào một danh sách:
- **Việc tự sinh** từ nghiệp vụ.
- **Việc giao thủ công** giữa các nhân viên.

## Cấu trúc (sửa ở đâu)
| Phần | File |
|---|---|
| Trạng thái, mức ưu tiên, nguồn việc (khoá + nhãn) | `src/modules/tasks/domain/task-config.ts` |
| Bảng dữ liệu `tasks`, `task_comments` | `src/modules/tasks/schema.ts` (migration `0015_tasks.sql`, phân quyền `0016_supabase_access_tasks.sql`) |
| Quy tắc việc tự sinh (mỗi nguồn một hàm) | `src/modules/tasks/api/auto-tasks.ts` → `RULES` |
| API | `src/modules/tasks/api/routes.ts` |
| Giao diện, màu sắc | `trial-ui/tasks.js` (`TASK_UI`) + phần "Công việc" trong `trial-ui/style.css` |

Thêm một nguồn việc tự sinh mới:
1. Thêm khoá vào `TASK_SOURCES`.
2. Viết một hàm trong `RULES`. Hàm trả danh sách các việc *cần có lúc này*, mỗi việc có `autoKey` duy nhất.
3. Thêm nhãn và màu cho khoá mới vào `TASK_UI.source`.

## Việc tự sinh
Mỗi lần mở bảng, hệ thống đồng bộ việc tự sinh, tối đa 15 giây một lần.
- Việc cần có mà chưa có thì được tạo.
- Chứng từ đã xử lý xong thì việc tự chuyển sang **Hoàn thành**.
- Khi chứng từ thay đổi, việc tự cập nhật người nhận, hạn và mô tả theo.

| Quy tắc | Tạo khi | Người nhận | Ưu tiên | Hạn |
|---|---|---|---|---|
| Duyệt báo giá khách gửi | báo giá khách gửi đang chờ duyệt | NV phụ trách | Cao | +1 ngày |
| Duyệt báo giá | NV lập báo giá, chờ Manager duyệt | *Chưa giao* (Manager) | Bình thường | +1 ngày |
| Trả lời check tồn | đơn check tồn chưa trả lời | NV phụ trách | Cao | trong ngày |
| Xác nhận đơn | đơn khách đặt chờ xác nhận | NV phụ trách đơn | Khẩn | +1 ngày |
| Lên lịch giao | đơn đã xác nhận còn hàng chưa lên lịch giao | NV phụ trách đơn | Bình thường | trước ngày giao dự kiến 1 ngày |
| Đến hạn / trễ hạn giao | đơn đã xác nhận, ngày giao dự kiến là hôm nay, ngày mai hoặc đã qua, chưa giao xong | NV phụ trách đơn | Cao (trễ: Khẩn) | ngày giao dự kiến |
| Giao hàng | chuyến giao hôm nay / ngày mai / đã trễ chưa xong | người giao hoặc NV phụ trách | Cao nếu đến ngày | ngày giao |
| Ký HĐKT | HĐKT đã lập chưa ký | NV phụ trách đơn | Bình thường | +3 ngày |
| Thu công nợ quá hạn | đơn có kỳ thu quá hạn | NV phụ trách đơn | Khẩn | kỳ quá hạn sớm nhất |
| Nhận hàng nhập | đơn nhập Sapo (60 ngày gần đây) chưa hoàn tất | Nhóm **Kho** | Bình thường | +7 ngày |
| Xuất kho & đóng hàng | NV phụ trách bấm **📦 Yêu cầu kho đóng hàng** ở một chuyến giao (ô Lịch giao hàng của đơn) | Nhóm **Kho** | Cao (giao trong 1 ngày: Khẩn) | ngày giao |

Quy định với việc tự sinh:
- Không xoá được. Việc tự đóng khi chứng từ đã xử lý xong.
- Không sửa được tên và mô tả.
- Đổi được người nhận, mức ưu tiên và hạn.

## Việc theo nhóm (Kho, Kế toán, Sale Admin)
- Chọn người nhận "Nhóm Kho / Nhóm Kế toán / Nhóm Sale Admin": mọi nhân viên có chức vụ đó thấy việc (mục *Việc nhóm* / *Tôi nhận*) và nhận thông báo.
- Một người bấm **Nhận việc** (hoặc chuyển sang *Đang làm* / *Hoàn thành*) là nhận việc đó.
- Danh sách nhóm: `TASK_TEAMS` trong `task-config.ts` (khoá = id chức vụ).
- Cột `tasks.assignee_position` (migration `0017_tasks_teams.sql`).

## Xuất kho & đóng hàng
1. NV phụ trách lên lịch giao, rồi bấm **📦 Yêu cầu kho đóng hàng** ở chuyến đó (có thể ghi chú cho kho).
2. Nhóm Kho nhận thông báo; việc ghi đủ: đơn, ngày / giờ giao, địa chỉ, từng mặt hàng + số lượng, ghi chú.
3. Kho bấm *Nhận việc* → *Hoàn thành*: NV phụ trách nhận thông báo, ô Lịch giao hàng hiện **Kho đã đóng hàng ✓ · tên người làm**.
4. Chuyến đã đi giao / đã giao / huỷ thì việc tự hoàn thành.

## Giao việc thủ công
- **Thêm nhanh** bằng một dòng: tên việc, người nhận, ưu tiên, hạn (có nút Hôm nay / Mai / +7 ngày), bấm Enter là lưu.
- **Ai làm được gì**:
  - Người giao và Manager sửa được mọi thông tin.
  - Người nhận đổi được trạng thái, ưu tiên, hạn, và giao lại cho người khác.
  - Chỉ người giao hoặc Manager huỷ / xoá được việc.
- **Ai thấy việc nào**: nhân viên thấy việc mình nhận và việc mình giao; Manager thấy tất cả, kể cả việc *chưa giao*.
- **Thông báo** (Web Push và chuông):
  - được giao việc → người nhận;
  - việc hoàn thành → người giao;
  - có tin nhắn trao đổi trong việc → người còn lại.
- **Danh sách** chia nhóm theo hạn: Quá hạn, Hôm nay, Sắp tới, Chưa đặt hạn.
- **Màu ưu tiên**:
  - Khẩn: đỏ.
  - Cao: cam.
  - Bình thường: xanh dương.
  - Thấp: xám.
- **Màu nguồn việc**: mỗi nguồn một màu nhẹ.
- **Phím tắt**: `N` thêm việc, `/` tìm kiếm.

## Ai xem được việc nào (chốt 09/10/2026)
| Chức vụ | Xem được |
|---|---|
| Manager | Mọi việc |
| Sale, Kế toán | Việc mình nhận, việc mình giao, và việc giao cho nhóm của mình mà chưa ai nhận. Không thấy việc của người khác. |
| Sale Admin, Kho, NVBH LOCK, NVBH ML | Như trên, **cộng thêm** việc mà đồng nghiệp **cùng chức vụ** nhận hoặc giao (bộ lọc "Cùng chức vụ"). |

Việc của đồng nghiệp cùng chức vụ là **chỉ xem**:
- **Không được thao tác:** không sửa, không đổi trạng thái, không nhận việc thay, không xoá.
- **Không thấy trao đổi:** không đọc và không gửi trao đổi (bình luận). Phần trao đổi là chuyện riêng giữa người giao, người nhận và Manager.
- **Máy chủ chặn**, không chỉ giao diện:
  - danh sách, chi tiết, sửa, xoá và trao đổi đều kiểm tra quyền;
  - xem không được trả 404, làm không được trả 403;
  - xem `src/modules/tasks/api/routes.ts` (`peerPos`, `peerCond`, `loadOwnTask`) và `PEER_VIEW_POSITIONS` trong `domain/task-config.ts`.
- **Chứng từ đính kèm:** link "Mở chứng từ" vẫn theo quyền riêng của từng trang. Không có quyền xem đơn hoặc báo giá đó thì không mở được.

Test: `tests/app/task-peers.test.ts`.
