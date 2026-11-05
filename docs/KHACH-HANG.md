# Khách hàng: danh sách, thêm mới, trang chi tiết

Manager có thể chuẩn bị, xem trước và đối soát khách/người liên hệ từ AppSheet; xem [APPSHEET-MAPPING.md](APPSHEET-MAPPING.md). Nhóm/loại khách (`customerType`) độc lập với khách lẻ/doanh nghiệp (`isRetail`).

## Form tạo khách đầy đủ

- Tạo tại trang Khách hàng bắt buộc **tên, người liên hệ, số điện thoại, MST và địa chỉ**, có dấu `*` trên giao diện và kiểm tra tại `POST /customers`.
- Có nhóm/loại khách, ngày thành lập, mã khách, email và điều khoản; thêm được ghi chú khách, người phụ trách/chia sẻ và nhiều liên hệ (tên/chức vụ/SĐT/email/ghi chú/cờ chính). Toàn bộ hồ sơ được lưu trong một transaction, lỗi thì không tạo dở.
- Manager chọn người phụ trách hoặc để chưa phân công. Nhân viên tạo thì tự phụ trách, khách chờ Manager duyệt; người được chia sẻ phải là nhân viên đang hoạt động.
- Chọn liên hệ chính điền tên vào trường người liên hệ, không tự thay điện thoại/email doanh nghiệp bằng thông tin cá nhân. Mỗi liên hệ thêm vào phải có tên, tối đa một cờ chính.
- **Tạo tại Bán hàng nhanh được miễn các trường bắt buộc trên**, kể cả tên. Không có SĐT/MST thì dùng chung “Bán người tiêu dùng”; có định danh nhưng chưa có tên thì hiển thị “Khách <SĐT/MST>”. Vẫn chống trùng MST/SĐT và kiểm tra định dạng/giới hạn trường đã nhập.
- Sửa hồ sơ cũ không bắt buộc điền lại dữ liệu lịch sử còn thiếu. Ngày tạo/nguồn Web/trạng thái duyệt do hệ thống quản lý; không nhập tay các khóa AppSheet hay thời điểm đồng bộ trong form.

API tạo khách bổ sung tùy chọn `ownerId`, `sharedIds`, `notes`, `contacts`; `contacts` dùng cùng cấu trúc với API danh bạ. Giới hạn 50 liên hệ/30 người chia sẻ/5.000 ký tự ghi chú. Nhân viên không được chọn người phụ trách khác khi tạo. Bộ test nghiệp vụ dùng `tests/helpers/customer-fixture.ts` cho dữ liệu giả đủ trường; test thiếu trường gọi API trực tiếp, không đi qua helper bổ sung dữ liệu.

## Giao diện
- **Danh sách** (`#/customers`):
  - Nút **＋ xanh lá** ở đầu trang để thêm khách hàng. Nút hiện cả trên máy tính và điện thoại.
  - Lưu xong thì mở luôn trang chi tiết của khách mới.
  - Có cột **Phụ trách** (kèm số người được chia sẻ) và ô lọc **Khách của tôi** (`?mine=1`).
  - **Bộ lọc:** người phụ trách/chưa phân công, trạng thái duyệt, loại khách (doanh nghiệp/khách lẻ theo quyền), ngày tạo theo giờ Việt Nam và sắp xếp. Dòng “Đang lọc” nêu điều kiện đang dùng. Xóa bộ lọc giữ từ khóa tìm kiếm và trả về trang đầu.
  - Trên điện thoại, mở **Lọc**, chọn điều kiện rồi bấm **Xem kết quả**; đóng bảng lọc thì bỏ các điều kiện chưa áp dụng. Ngày không hợp lệ không gửi truy vấn.
  - Khách đã duyệt có nút **＋ Giao dịch** trước **＋ Báo giá** khi tài khoản có quyền Giao dịch & chăm sóc; mở form hiện có, chọn sẵn đúng khách và danh bạ liên hệ. Bấm nút chưa ghi giao dịch; chỉ lưu khi người dùng hoàn tất form.
  - Popup giao dịch PC rộng 840px (150% của bản 560px); điện thoại vẫn giới hạn theo màn hình. Chọn khách sẽ tải đủ danh bạ, ưu tiên liên hệ chính, có lựa chọn nhập tay và tải lại khi lỗi. Đổi khách xóa liên hệ cũ ngay; phản hồi chậm không ghi đè khách mới. Nội dung là ô nhiều dòng, tối đa 2.000 ký tự; khi sửa giữ nguyên người liên hệ đã ghi.
  - Bấm vào dòng hoặc tên khách để mở trang chi tiết.
- **Trang chi tiết** (`#/customers/<id>`, file `trial-ui/customer-detail.js`):
  - **Đầu trang:** tên khách, nhãn *Sapo* hoặc *Tạo trên web*, nút **Sửa thông tin** và **＋ Báo giá**.
  - **Thống kê:** doanh số (đơn đã xác nhận), đã thu, còn nợ (kèm quá hạn), lần mua gần nhất.
  - **Hồ sơ:**
    - Thông tin: mã KH, MST, liên hệ chính, điện thoại, email, địa chỉ.
    - Nhân viên: phụ trách và được chia sẻ, kèm nút *Phân công / chia sẻ*.
    - Người liên hệ: thêm, sửa, xoá; đánh dấu liên hệ chính.
  - **Các mục (tab):** Đơn hàng · Báo giá · HĐKT · Giao dịch (phiếu thu) · Công nợ · Lịch sử mua · Giao hàng · Hỏi tồn · Tài khoản.
  - Thêm một mục mới chỉ cần thêm một phần tử vào mảng `TABS`: key, nhãn, hàm đếm, hàm vẽ.

## Dữ liệu (chuẩn hoá, mỗi thứ một bảng)
| Bảng | Nội dung |
|---|---|
| `sapo_customers` | Hồ sơ khách. Khách từ Sapo có id số; khách tạo trên web có id UUID và Sapo không ghi đè. Liên hệ chính ở cột `contact/phone/email`. |
| `customer_staff` | Nhân viên gắn với khách. Khoá chính `(customer_id, member_id)`. `role` = `owner` (phụ trách, tối đa 1 người, có unique index riêng) hoặc `shared` (được chia sẻ). |
| `customer_contacts` | Người liên hệ bổ sung (kế toán, mua hàng, người nhận hàng…): họ tên, chức vụ, điện thoại, email, ghi chú, `is_primary`. |
| `customer_accounts` | Tài khoản trang khách hàng (đã có). |
| `sales_orders`, `sales_contracts`, `customer_payments`, `deliveries`, `payment_schedules`, `staff_quotations` (`data.customerId`), `customer_stock_requests` | Dữ liệu giao dịch, gom theo `customer_id`. Không chép sang bảng khác. |

- Hằng số vai trò và giới hạn nằm ở `src/modules/customers/domain/customer-config.ts`.
- Giới hạn số dòng của trang chi tiết nằm ở `src/modules/customer-hub/domain/overview.ts`.
- Migration: `0022_customer_staff_contacts.sql`, phân quyền ở `0023_supabase_access_customer_staff_contacts.sql`.
- Migration 0022 gán sẵn người phụ trách cho khách đã có, theo thứ tự ưu tiên:
  1. người phụ trách đơn gần nhất của khách;
  2. nếu khách chưa có đơn, người phụ trách tài khoản trang khách hàng.
- Khách chưa có người phụ trách: khi tạo đơn đầu tiên, người phụ trách đơn tự thành người phụ trách khách.

## Quyền
- **Thêm khách:** người tạo thành người phụ trách. Manager chọn được người khác qua `ownerId`.
- **Xem toàn bộ** báo giá, đơn, HĐKT, công nợ của khách: Manager, người phụ trách, người được chia sẻ.
  - Phạm vi đơn (`orderScopeFor` trong `sales`) có thêm điều kiện "khách mình phụ trách / được chia sẻ". Vì vậy người được chia sẻ mở được trang chi tiết đơn, HĐKT, lịch giao và công nợ của khách đó.
  - Báo giá vẫn theo quyền báo giá cũ khi mở chi tiết. Trang khách chỉ liệt kê báo giá của khách cho người có quyền xem toàn bộ.
- **Nhân viên khác:** trên trang chi tiết chỉ thấy phần mình phụ trách hoặc tự tạo.
- **Đổi người phụ trách:** chỉ Manager. **Đổi danh sách chia sẻ:** Manager hoặc người phụ trách.
- **Người liên hệ:** mọi nhân viên kinh doanh đều thêm, sửa được.

## API
| Route | Việc |
|---|---|
| `GET /customers?q=&mine=1` | Danh sách, mỗi dòng kèm `owner` và `sharedCount`. |
| `POST /customers` / `PUT /customers/:id` | Thêm / sửa hồ sơ. |
| `GET /customers/:id` | Hồ sơ, người phụ trách, người được chia sẻ, người liên hệ, quyền của người xem. |
| `PUT /customers/:id/staff` | `{ ownerId?, sharedIds? }`. |
| `POST/PUT/DELETE /customers/:id/contacts[/:contactId]` | Người liên hệ. |
| `GET /customers/:id/overview` | Trang chi tiết, gom trong một lượt (module `customer-hub`): hồ sơ, `stats`, `quotes`, `orders` (kèm công nợ), `contracts`, `payments`, `deliveries`, `purchases`, `stockRequests`, `accounts`. |

Module `customer-hub` chỉ đọc. Module này được import `staff`, `customers`, `quotes`, `sales`, `portal` (xem `tests/architecture.test.ts`).

## Duyệt khách hàng mới
- Nhân viên thêm khách → `approval_status = 'pending'` ("Chờ duyệt"). Manager thêm → `approved` ngay.
- Khách chờ duyệt: không có trong ô chọn khách khi lập báo giá (`GET /customers?usable=1`), không lập đơn được và không cấp tài khoản khách được (409 `CUSTOMER_PENDING`).
- `POST /customers/:id/approve`: chỉ Manager. `DELETE /customers/:id`: từ chối / xoá khách **đang chờ duyệt** (Manager hoặc người tạo).
- `GET /customers?status=pending` lọc khách chờ duyệt; mọi phản hồi danh sách kèm `pendingCount`.
- Khách đồng bộ từ Sapo luôn là `approved`. Cột: `approval_status`, `created_by`, `approved_by`, `approved_at` (migration `0024_approvals_member_delete.sql`).



## Ghi chú chung nội bộ

- Trang chi tiết khách có thẻ **Ghi chú chung về khách hàng** trước các tab chứng từ. Nội dung tối đa 5.000 ký tự, giữ xuống dòng; có người cập nhật và thời gian lưu.
- Manager / người phụ trách được thêm, sửa, xoá nội dung. Người được chia sẻ, nhân viên cùng phòng ban và Sale Admin được xem theo phạm vi hiện có. Người ngoài phạm vi không nhận nội dung; cổng khách hàng và NCC không được đọc hoặc sửa.
- `customer_notes` lưu riêng theo `customer_id`, tránh bị đồng bộ hồ sơ Sapo ghi đè. Không đưa vào báo giá, đơn, HĐKT hoặc hồ sơ khách trên portal.
- `GET /customers/:id/notes` đọc nội dung; `PUT /customers/:id/notes` nhận `{ text, revision }`. Lần đầu `revision=0`; server trả phiên bản mới. Bản cũ bị từ chối 409 thay vì ghi đè thay đổi của người khác. `GET /customers/:id` và `/overview` có `generalNote` (null nếu không có quyền).
- Gộp khách trùng giữ ghi chú của cả hai bản. Tổng nội dung quá 5.000 ký tự thì từ chối gộp, giữ nguyên dữ liệu để Manager rút gọn trước.
- Chạy `0055_customer_notes.sql`, rồi `0056_supabase_access_customer_notes.sql` **trước khi deploy API mới**. Bảng bật RLS, không cấp quyền trực tiếp cho PUBLIC/anon/authenticated; quyền đọc/sửa kiểm tra ở API.

## Bổ sung khách lẻ từ Sapo

Migration `20261019030603_retail_customers.sql` thêm `sapo_customers.is_retail`, mặc định false cho hồ sơ cũ. Không phân loại hay ghi đè hồ sơ cũ. Đợt nhập riêng quét toàn bộ các trang Sapo, chỉ thêm khách thuộc nhóm Khách lẻ hoặc khách cá nhân không MST; tổ chức thiếu MST không tự coi là cá nhân. Khách trùng ID Sapo, mã khách, MST có giá trị hoặc điện thoại chuẩn hoá bị bỏ qua (không tự gộp). Cùng tên khác điện thoại vẫn có thể là hai người khác nhau. Khách bổ sung được đánh dấu is_retail=true và dùng ngay.

GET /customers và GET /pos/customers hỗ trợ `kind=retail|business`; NVBH LOCK/ML và Manager được thấy bộ lọc Khách lẻ, các chức vụ nhân viên khác luôn loại nhóm này khỏi danh sách/tìm kiếm/phân trang kể cả tự thêm query. Quyền xem liên kết khách trên chứng từ cũ không đổi. Khách doanh nghiệp giữ nguyên luồng hiện tại; đồng bộ thường không ghi đè hồ sơ đã đánh dấu retail.

Chạy workflow **Đồng bộ Sapo**, scope=retail: mỗi lần gọi đọc tối đa hai trang, lưu con trỏ riêng trong sapo_health_monitor_state, chạy lại tiếp tục và không thêm trùng. Không reset cursor sản phẩm/nhân viên, không đổi cron. API `/integrations/sapo/retail-customers/pull` dùng mã đồng bộ sẵn có; `/admin/sapo-retail-customers` chỉ Manager. Không trả dữ liệu liên hệ hay credential trong kết quả. Nhận completed=true mới hết trang; nếu có warning nhóm thì cần đối chiếu trước khi tuyên bố đủ cả hai nhóm.

### Ngày thành lập và gợi ý kỷ niệm

Form thêm/sửa khách có **Ngày thành lập** (không bắt buộc). Chỉ nhận ngày thực tế, không ở tương lai; để trống để xóa. Client cũ không gửi trường này khi sửa sẽ giữ nguyên giá trị cũ. Đồng bộ Sapo không ghi đè ngày CRM đã nhập.

Danh sách và hồ sơ khách hiển thị mốc kỷ niệm tiếp theo theo chu kỳ **5, 10, 15, 20… năm**, gồm ngày diễn ra và số ngày còn lại. **Kỷ niệm sắp tới** liệt kê các khách doanh nghiệp đã duyệt có mốc trong **60 ngày** tới (bao gồm hôm nay), để sale liên hệ tìm hiểu kế hoạch sự kiện và tư vấn quà tặng/ấn phẩm. Không tự gửi tin nhắn hay tạo công việc. Sale xem khách thuộc phạm vi sở hữu/chia sẻ/phòng ban hiện có; Manager và Sale Admin theo phạm vi toàn công ty của vai trò. Lọc toàn bộ trước khi giới hạn 100 gợi ý gần nhất.

Công thức chọn bội số 5 năm chưa qua: nếu mốc năm nay đã qua thì chuyển sang mốc tiếp theo; không lấy số ngày chia 365 để tính tuổi. Ngày 29/2 được tính vào 28/2 ở năm không nhuận. Dùng ngày lịch Việt Nam; không suy đoán ngày thành lập từ ngày tạo hồ sơ hoặc ngày đồng bộ Sapo.

Migration: `20261105010141_customer_established_date.sql` thêm cột `sapo_customers.established_date` kiểu `date`, cho phép null và ràng buộc năm 0001–9999. Phải áp dụng trước deploy API/UI; workflow API có read-only gate `scripts/sql/assert-customer-established-date.sql` để không thay API đang hoạt động khi thiếu cột. Không thay đổi RLS hoặc cấp quyền truy cập mới.

Công thức dùng chung server/browser ở `customers/domain/anniversary.ts`; `npm run ui:build` sinh `trial-ui/customer-anniversary.js`. Test: `tests/app/customer-anniversary.test.ts`; kiểm tra trình duyệt local: `scripts/testing/customer-anniversary.mjs`.
