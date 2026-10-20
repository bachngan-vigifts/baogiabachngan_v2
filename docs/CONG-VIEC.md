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
- Việc duyệt (báo giá, báo giá khách, xác nhận đơn, đơn mua NCC) và việc nhận hàng NCC **không bấm xong tay được**: chỉ tự đóng khi duyệt / nhận xong ở màn hình gốc.
- Một quy tắc lỗi khi đối chiếu thì lần đó **không đóng** việc nào (tránh đóng nhầm); việc tự đóng mà chứng từ lại cần xử lý (vd báo giá bị trả lại rồi gửi duyệt lại) được **mở lại**.
- Báo giá khách gửi: việc "Xác nhận báo giá khách" chưa giao cho ai cụ thể – ai trong nhóm duyệt nhận trước thì làm.
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

## Ai xem được việc nào
| Chức vụ | Xem được |
|---|---|
| Manager | Mọi việc |
| Nhân viên có nhóm/chức vụ | Việc mình nhận/giao, việc nhóm chưa ai nhận, cộng thêm việc đồng nghiệp đang hoạt động **cùng nhóm/chức vụ** nhận/giao (chỉ đọc). |
| Nhân viên chưa gán nhóm | Chỉ việc mình nhận/giao. |

Việc của đồng nghiệp cùng chức vụ là **chỉ xem**:
- **Không được thao tác:** không sửa, không đổi trạng thái, không nhận việc thay, không xoá.
- **Không thấy trao đổi:** không đọc và không gửi trao đổi (bình luận). Phần trao đổi là chuyện riêng giữa người giao, người nhận và Manager.
- **Máy chủ chặn**, không chỉ giao diện:
  - danh sách, chi tiết, sửa, xoá và trao đổi đều kiểm tra quyền;
  - xem không được trả 404, làm không được trả 403;
  - xem `src/modules/tasks/api/routes.ts` (`peerPos`, `peerCond`, `loadOwnTask`) và `canViewPeers` trong `domain/task-config.ts` (không hard-code tên nhóm).
- **Chứng từ đính kèm:** link "Mở chứng từ" vẫn theo quyền riêng của từng trang. Không có quyền xem đơn hoặc báo giá đó thì không mở được.

Test: `tests/app/task-peers.test.ts`.


Giao diện nhận `canViewColleagues` từ API `/tasks` để hiện bộ lọc đồng nghiệp; các nhóm lấy từ chức vụ hiện có.


### Việc nhận hàng NCC tự hoàn thành theo chứng từ

Việc tự sinh có khoá `po-receive:` không có ô tick hoàn thành, không có lựa chọn Hoàn thành/Huỷ ở bảng hay chi tiết. Người dùng vẫn nhận việc và chuyển sang Đang làm được. Ghi nhận đủ hàng trên đơn mua thì việc tự hoàn thành qua cơ chế đồng bộ việc hiện có. API trả `completionFromSource` và chặn hoàn thành/huỷ/mở lại thủ công (kể cả Manager), mã `TASK_SOURCE_MANAGED`. Việc thủ công và các loại việc tự sinh khác giữ nguyên.

## Hàng đợi Kế toán

Chức vụ `accounting` mở `#/tasks` mặc định bằng hàng đợi Kế toán. Người có `purchases.pay` (bao gồm Sale Admin theo quyền hiện có) có nút **Nhóm Kế toán** trên bảng chung. Nút **Công việc khác / Thêm việc** quay lại bảng chung. Manager giữ bảng chung, không đổi chức vụ, quyền hay luồng duyệt hiện có.

- API `GET /tasks/accounting?view=team|mine|colleagues|closed_today&kind=invoice|purchase|debt|web&q=...&offset=...`: kiểm tư cách nhóm ở server, sau đó dùng cùng phạm vi nhiệm vụ hiện có. Phân trang 100 dòng, KPI/tổng tab tính trước phân trang và bộ lọc loại/tìm kiếm.
- `GET /tasks/accounting/:id`: kiểm tư cách nhóm và quyền xem đúng nhiệm vụ; trả dữ liệu nguồn, hướng dẫn và lịch sử từ các mốc thật trên nhiệm vụ. Không có mốc thì không tự dựng lịch sử.
- Bốn KPI: xuất HĐ chờ (gồm web), kỳ NCC chưa trả đủ có hạn tới hôm nay +3 ngày (gồm quá hạn), nợ quá hạn đang theo dõi, việc nhóm chưa nhận. Việc đã đóng không cộng vào các KPI đang mở.
- Hai hàng lọc: nhóm/của tôi/đồng nghiệp/đóng hôm nay và loại việc. Đồng nghiệp chỉ gồm việc chỉ xem, không lẫn việc nhóm chưa nhận. Đóng hôm nay dùng `completed_at` theo giờ Việt Nam, không suy đoán từ giờ cập nhật khác.
- `sourceData` lấy trực tiếp đơn, lịch thu/chi, phiếu thu/chi chưa huỷ, đơn mua và dữ liệu đơn web. Công nợ giữ các hàm `receivable`, `supplierDebt`, `computeOrderTotals` hiện có. Không tách tiền trong mô tả; không thêm cột/bảng hay migration. Kỳ NCC giữ nhiệm vụ khi chuyển sang quá hạn, chỉ tự đóng khi kỳ được trả đủ, đơn bị huỷ hoặc không còn điều kiện.
- Quyền số tiền và link kiểm lại theo quyền trang/phạm vi đơn và quyền giá NCC. Không được xem nguồn thì API không trả số tiền hay mô tả có số tiền; giao diện báo dữ liệu bị ẩn. Web không có trang đơn cho Kế toán hiện nhãn **Không có link đơn** và mã GHN nếu được xem chi tiết.
- `invoice:`, `po-pay:`, `debt-overdue-acc:` chỉ hoàn thành theo chứng từ. Đóng/huỷ/mở lại tay bị chặn `409 TASK_SOURCE_MANAGED`, kể cả Manager. Vẫn nhận việc và chuyển Đang làm được.
- Việc tự sinh không xoá được. Nhận/sửa việc kiểm revision tại UPDATE để hai người không cùng nhận đè nhau.
- Trao đổi của các nhiệm vụ kế toán tự sinh chỉ người đang nhận và Manager được đọc/gửi. Người cùng chức vụ chỉ xem không được đọc/gửi, người trong nhóm chưa nhận cũng không đọc/gửi được. Bảng Công việc chung của các loại khác giữ quyền cũ.

### Các điểm chưa chốt

**B — Mở lại việc đã đóng tay:** mặc định không mở lại. API trả `warnings` cho việc đóng tay có điều kiện nguồn còn đúng, gồm số tiền tồn và link theo quyền; chỉ cảnh báo. Nguồn không được xem hoặc không xác định được tồn thì không suy đoán. Việc hệ thống tự đóng vẫn giữ cơ chế mở lại theo chứng từ cũ.

**C — Đóng việc web:** `invoice-web:` vẫn đóng tay; hướng dẫn ghi số hoá đơn trong Trao đổi. Vì web chưa có trạng thái xuất HĐ, không suy luận rằng việc đã đóng tay còn chờ HĐ và không tự mở lại hay cảnh báo tồn giả cho trường hợp này.

**C — Trang đơn web cho Kế toán:** chưa có trang được cấp quyền phù hợp để gắn link. Giữ nhãn Không có link đơn, không mở thêm quyền POS và không tạo trang mới.

Kiểm thử: `tests/app/accounting-tasks.test.ts`, `accounting-tasks-ui.test.ts`, cùng hồi quy `tasks`, `task-peers`, `task-cards-ui`, `invoice-tasks`. Kiểm thử giao diện dùng dữ liệu mẫu; chưa kiểm thử live hoặc máy in.
