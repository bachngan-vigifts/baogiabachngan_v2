# Bảng Công việc

Trang **Công việc** (`#/tasks`) gom hai loại việc vào một danh sách:
- **Việc tự sinh** từ nghiệp vụ.
- **Việc giao thủ công** giữa các nhân viên.

Bố cục dùng cùng khung với Báo giá, Đơn hàng và HĐKT: tiêu đề trang, tab dạng chip, bốn thẻ thống kê và một panel chứa bộ lọc/danh sách. Trên máy tính, các dòng việc có tiêu đề cột và được chia nhóm theo hạn hoặc nhóm việc; trên điện thoại, thống kê xếp 2 × 2 và từng việc hiển thị thành thẻ. Bộ lọc hạn, mở chi tiết và tab Cần duyệt giữ nguyên thao tác.

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
3. Thêm nhãn và màu cho khoá mới vào `TASK_UI.source` và đưa khoá vào một nhóm ở `TASK_UI.categories`.
4. Viết migration đổi ràng buộc `chk_tasks_source` (vd. `20261022090000_task_source_cash.sql`).

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
| Duyệt phiếu thu/chi (Sổ quỹ) | phiếu từ ngưỡng duyệt trở lên đang chờ (vd. NV **nộp két** ≥ 1.000.000 đ) | *Chưa giao* (Manager) | Cao | ngày lập |
| Duyệt đổi / trả hàng POS | yêu cầu đổi / trả đang chờ duyệt | *Chưa giao* (Manager) | Cao | ngày lập |
| Giải trình lệch két | kết ca / mở ca lệch tiền → phiếu tra soát chưa giải trình | NV của ca | Cao | +1 ngày |
| Đóng tra soát | NV đã giải trình, chờ Manager đóng | *Chưa giao* (Manager) | Cao | +1 ngày |
| Kết ca quên | ca của ngày trước vẫn chưa kết | người mở ca | Khẩn | ngày của ca |

Việc **Sổ quỹ** (nguồn `cash`) được đồng bộ **ngay** khi lập / duyệt / huỷ phiếu, lập / duyệt / huỷ yêu cầu đổi trả, mở / kết ca và giải trình / đóng tra soát (`cashTasksChanged`), không đợi ai mở trang Công việc. Người duyệt đã có thông báo riêng nên không báo thêm "Việc mới". Người **được Manager chỉ định duyệt** thấy phiếu thu/chi và đổi/trả ở hộp **Cần duyệt** (đúng két / quầy cửa hàng mình, không thấy phiếu tự lập).

## Giao diện
- **Tiêu đề**: giờ đồng bộ việc tự sinh ("Đồng bộ lúc HH:MM") + nút ↻ làm mới (gửi `refresh=1`), nút **+ Giao việc** (phím `N`) mở ô giao việc.
- **Tab chế độ xem** có số việc đang mở (`GET /tasks/summary` → `views`): Của tôi · Tôi giao · Việc nhóm *[tên nhóm của tôi]* · Đồng nghiệp (khi được xem) · Chưa giao (Manager) · Tất cả · **Cần duyệt** (người duyệt).
- **4 thẻ hạn**: Quá hạn · Đến hạn hôm nay · Sắp tới (7 ngày) · Chưa đặt hạn. Số trên thẻ đếm theo tab + bộ lọc hiện tại, trước khi lọc hạn (`GET /tasks` → `dueCounts`). Bấm để lọc, bấm lại để bỏ.
- **Một thanh lọc**: tìm · trạng thái (Đang mở / Đã xong / Tất cả) · Nguồn (gom theo Bán hàng, Kho & giao hàng, Kế toán & tiền, Chăm sóc khách, Thủ công – đủ mọi nguồn) · Ưu tiên · Người nhận (`assignee`: nhân viên, `team:<nhóm>`, `none`) · Hạn (`due`: overdue · today · week · upcoming · none).
- **Chip bộ lọc đang bật** (× từng cái, *Xoá bộ lọc*); khi không có kết quả, dòng trống nói rõ lọc gì.
- **Danh sách** nhóm theo hạn (mặc định) hoặc theo nhóm việc (nút *Nhóm theo* ở chân trang, nhớ trên máy). Mỗi việc một thẻ: ô tick | Việc (tiêu đề, nguồn, Tự động, mô tả) | Người nhận (người giao nhỏ bên dưới, *Nhận việc*) | Hạn (trễ / còn bao nhiêu ngày) | Ưu tiên | Trạng thái (bấm đổi Cần làm ↔ Đang làm). Viền trái đỏ = khẩn / quá hạn, cam = cao.
- **Hoàn thành**: việc làm tay dùng ô tick. Việc tự hoàn thành theo chứng từ không có ô tick (⟳ + nhãn "Tự động · không đóng tay").
- **Chi tiết**: màn hình ≥1280px mở khung bên phải (chọn việc khác bằng ↑↓, Esc đóng); màn hình nhỏ mở hộp thoại (điện thoại: toàn màn hình). Tab Chi tiết · Trao đổi · Lịch sử.
- **Chân trang**: "Hiển thị X / Y việc" + phím tắt (`N` giao việc · `/` tìm · `↑↓` chọn việc · `Enter` mở).
- Điện thoại: mỗi việc là một thẻ, chỉ hiện Việc, Hạn, Trạng thái.

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

### Cảnh báo thiếu dữ liệu NCC và GHN

Hàng đợi Kế toán trả thêm `sourceWarnings` từ `GET /tasks/accounting`, độc lập với tab, bộ lọc loại và tìm kiếm. Hai khối thu gọn ở đầu trang không cộng vào KPI/nhiệm vụ đang mở:

- **NCC chưa có hạn trả:** đếm các kỳ chưa được trả đủ và chưa có `due_date` trên đơn mua đã duyệt, chưa huỷ, còn nợ. Phân bổ phiếu chi chưa huỷ theo thứ tự hạn/độ làm tròn hiện có; bỏ kỳ đã được trả đủ. Kiểm `page.purchases`, quyền xem giá và `purchaseScope` tại server trước khi đọc/trả danh sách. Link **Bổ sung hạn trả** mở đơn mua hiện có, không tự sửa hay đoán ngày. Khi bổ sung ngày, cơ chế đối soát nhiệm vụ hiện có sinh việc Trả NCC cho kỳ đủ điều kiện.
- **Theo dõi dữ liệu GHN:** metadata của đơn web chưa huỷ/hoàn tiền/thất bại/trash, tách **Chưa có mã vận đơn**, **Có mã nhưng chưa nhận trạng thái GHN**, **Đã giao thành công**, và trạng thái đang theo dõi. `missingStatus` chỉ đếm đơn đã có mã, tránh đếm trùng với `missingCode`. Chỉ nhóm Kế toán/Manager được đọc qua API kế toán; người thuộc cửa hàng vẫn bị giới hạn quầy dù được cấp thêm `purchases.pay`. Không trả tên khách, điện thoại, địa chỉ, email hay số tiền trong diagnostics; không thêm link/quyền POS. Đơn web giao thành công vẫn qua quy tắc invoice hiện có, không suy đoán từ trạng thái website `completed`.
- Mốc **Dữ liệu web cập nhật** dùng `web_store_orders.updated_at` do website gửi (`date_modified_gmt`, thường không có hậu tố múi giờ), hiển thị giờ Việt Nam. Đây không phải thời điểm kiểm tra GHN hoặc một lần đồng bộ được ghi riêng; không tự khẳng định dữ liệu còn mới. Chưa có mốc riêng thì không tạo số liệu thay thế.

Không migration, không thay công thức công nợ/số tiền, không thêm quyền hoặc cron; không tự mở lại việc đóng tay. Kiểm thử API/DOM tại `tests/app/accounting-tasks*.test.ts`.
