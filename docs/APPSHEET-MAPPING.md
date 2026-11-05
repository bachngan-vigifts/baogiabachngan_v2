# Nhập khách hàng và người liên hệ AppSheet → CRM

Phạm vi: nhập một chiều từ bản xuất JSON có cấu trúc đã kiểm tra. Chỉ Manager được xem trước, đối soát, nhập và xem lịch sử. Không tự kết nối AppSheet, đặt lịch hay ghi ngược. Migration và dữ liệu thật trên production chờ Anh Thái xác nhận riêng sau khi duyệt PR/CI.

## Khóa và mapping

Kiểm tra AppSheet Definition / `vigifts_appsheet_fields.is_key` trước khi lập cấu hình. Repo đã có schema mirror nhưng không giả định mirror có dữ liệu/cập nhật. Dùng Key ổn định, không dùng `_RowNumber`, số dòng Google Sheets hoặc tên hiển thị. Liên hệ dùng Ref tới Key khách.

| AppSheet | CRM |
| --- | --- |
| App ID + bảng khách + Key khách | PK `(app_id, table_name, row_id)` của `appsheet_customer_links` |
| App ID + bảng liên hệ + Key liên hệ | PK tương ứng của `appsheet_contact_links` |
| Ref khách của liên hệ | `customer_row_id` → link khách → `customer_contacts.customer_id` |
| Mã/tên/địa chỉ/MST/SĐT/email khách | `customerCode/name/address/taxCode/phone/email` |
| Loại/nhóm khách | `customerType` / `customer_type`; độc lập `isRetail` và phạm vi quyền |
| Ngày thành lập | `establishedDate` / `established_date` **đã có**, không thêm `founded_date` |
| Tên người liên hệ chính | `sapo_customers.contact`; không thay SĐT/email chung bằng thông tin cá nhân |
| Danh bạ | `customer_contacts.name/title/phone/email/note/isPrimary` |
| Ngày tạo gốc | Link khách: `source_created_at` |
| Thời điểm sửa nguồn | Mỗi link: `source_updated_at` |
| Trạng thái phê duyệt gốc | Link khách: `approval_raw` |
| Lần nhập thành công gần nhất | Mỗi link: `synced_at`, riêng với timestamp đồng bộ Sapo |
| Nguồn tạo ban đầu | `sapo_customers.data_source`: appsheet/sapo/web/pos; không đoán nguồn bản ghi cũ |

Không thay ID CRM hiện có bằng Key AppSheet. Nhiều dòng nguồn có thể gắn cùng khách CRM nên không đặt một `appsheet_row_id UNIQUE` trực tiếp trên khách. Mã khách chưa phải khóa duy nhất. Key liên hệ và Ref khách được lưu riêng, không dùng hai cột ID nguồn có nghĩa mơ hồ.

## Chuẩn bị ngoài repo

1. Xuất hai bảng thành hai mảng JSON. SĐT/MST/mã phải là chuỗi, giữ số 0 đầu. Không commit file thật.
2. Sao chép `docs/examples/appsheet-mapping.example.json` vào thư mục riêng; thay App ID, bảng và cột theo cấu trúc thực tế. Chỉ đặt `keyConfirmed: true` khi đã xác nhận Key và Ref. Tên cột ví dụ không khẳng định cấu trúc app thật.
3. Khai báo `dateOrder: DMY` hoặc `ISO`, `localOffset`, thường `+07:00`. Ngày thành lập chuẩn hóa YYYY-MM-DD; timestamp nguồn chuẩn hóa ISO UTC. Không tự lấy giờ import thay ngày sửa nguồn. Nếu nguồn thiếu timestamp sửa đáng tin cậy, cần hoàn thiện exporter/chiến lược snapshot trước khi chạy lặp.
4. Chạy offline, không gọi database/API:

```bash
node --import tsx scripts/prepare-appsheet-customers.ts \
  --mapping /tmp/appsheet-private/mapping.json \
  --customers /tmp/appsheet-private/customers.json \
  --contacts /tmp/appsheet-private/contacts.json \
  --out /tmp/appsheet-ready
```

Thư mục đích phải chưa tồn tại. File chỉ chủ sở hữu được đọc; stdout chỉ báo số lô. Chia tối đa 200 dòng/lô; nếu file vượt 2 MB, chia tiếp trước khi nhập. Nhập theo số file: khách trước, liên hệ sau. Đối soát khách bị chặn rồi chạy lại lô liên hệ.

## Xem trước và áp dụng

Manager → Khách hàng → **Nhập AppSheet** → chọn file → **Xem trước**. Báo cáo tạo mới/gắn bản cũ/cập nhật/giữ nguyên/từ chối nguồn/xung đột/nguồn cũ/tạm chặn.

- Trùng MST/SĐT/mã/tên chỉ tạo ứng viên. Manager chọn bản CRM tương ứng rồi xem trước lại. Chỉ trùng tên đơn thuần mới cho chọn tạo khách khác cùng tên. Liên hệ nghi trùng cần đối soát trong đúng khách; không tự gộp danh bạ.
- Nhập theo bản xem trước: thay đổi dữ liệu CRM hoặc lựa chọn sẽ yêu cầu xem lại (`409 APPSHEET_PREVIEW_STALE`). Hash bao gồm snapshot danh bạ nên thay đổi khách ngoài lô cũng có thể làm hết hiệu lực.
- Khi lỗi/mất kết nối, xem trước và xem lịch sử trước khi thử tiếp. Không gửi lại hash cũ. Khóa định danh cùng transaction ngăn nhập trùng khi hai yêu cầu chạy đồng thời.
- Dòng xung đột bị bỏ qua và báo rõ; dòng hợp lệ nhập cùng transaction với nhật ký số lượng. Lỗi DB hủy toàn bộ lô. Nhật ký không chứa SĐT/email/nội dung nguồn.

API dùng cookie Manager và kiểm Origin/CSRF hiện có:

```text
POST /api/staff/appsheet-customers/preview  { input }
POST /api/staff/appsheet-customers/apply    { input, planHash }
GET  /api/staff/appsheet-customers/runs
```

```json
{
  "format": "appsheet-customers-v1",
  "appId": "app-id-da-xac-nhan", "customersTable": "KhachHang", "contactsTable": "NguoiLienHe",
  "customers": [{
    "rowId": "KEY-KH-001", "updatedAt": "2026-11-01T08:00:00+07:00", "createdAt": "2020-01-01T00:00:00+07:00",
    "fields": {"name": "Khách mẫu", "approvalStatus": "Đã duyệt", "customerType": "Nhà máy", "establishedDate": "2010-01-01"}
  }],
  "contacts": [{
    "rowId": "KEY-LH-001", "customerRowId": "KEY-KH-001", "updatedAt": "2026-11-01T08:00:00+07:00",
    "fields": {"name": "Liên hệ mẫu", "title": "Thu mua", "isPrimary": true}
  }],
  "resolutions": {"customers": {}, "contacts": {}}
}
```

Đối soát: `resolutions.customers[KEY_KH] = ID_CRM`, `resolutions.contacts[KEY_LH] = ID_LIEN_HE_CRM`; sau đó xem lại. Link đã gắn không được chuyển tự động. Mỗi loại tối đa 200 dòng/lô; liên hệ tối đa 50/khách theo API hiện tại. Tham số/cột không hỗ trợ bị chặn thay vì bỏ qua âm thầm.

## Ghi đè và vòng đời

- Bản mới: nguồn sở hữu trường thực sự gửi. Bản CRM đã có: chỉ điền ô trống; không chiếm quyền các ô đã có giá trị, kể cả giá trị giống AppSheet.
- Lần sau chỉ cập nhật trường đã nhập và còn bằng giá trị lần nhập trước. Nhân viên sửa thì giữ CRM, báo tên trường giữ lại. Đối chiếu ba giá trị: nguồn mới, giá trị từng áp dụng, CRM hiện tại.
- Trường không gửi giữ nguyên. Rỗng/null hợp lệ là yêu cầu xóa nhưng vẫn chịu quy tắc sở hữu; tên không được rỗng.
- Giữ ngày tạo CRM, timestamp/phiên bản Sapo, điều khoản thanh toán/công nợ, chiết khấu, ghi chú khách, phân công/chia sẻ và liên hệ thủ công. **Ghi chú khách và phân công chưa nằm trong hợp đồng nhập này**: cần mapping nhân viên/ghi chú được duyệt riêng; không suy ra nhân viên theo tên hoặc tự mở rộng quyền.
- `Đã duyệt/approved` → approved; `Đợi duyệt/Chờ duyệt/pending` → pending. `Từ chối/rejected` mới được lưu `quarantined` trên link, không tạo khách sử dụng. Nguồn từ chối khách CRM đã có thì báo xung đột. Không thêm enum rejected rời rạc vào luồng CRM cũ.
- Phiên bản cũ bị bỏ qua. Cùng timestamp khác nội dung bị chặn. Trạng thái/ngày/khóa không hợp lệ bị báo lỗi, không tự đoán hoặc tự duyệt.
- Giữ liên hệ chính đã có. Không tự tắt cờ chính khác, không tự đồng bộ ngược từ danh bạ sang thông tin chính của doanh nghiệp.
- Không xóa/ẩn vì thiếu dòng trong một file/lô. CRM xóa khách chờ duyệt hoặc liên hệ thì FK link thành NULL, giữ dấu vết chặn nhập lại. Gộp khách chuyển mọi link sang ID giữ lại; không mất liên kết chứng từ.
- Snapshot nguồn/giá trị sở hữu lưu trên link để đối soát; có dữ liệu cá nhân nên RLS bật, không cấp quyền Data API cho anon/authenticated. API chỉ Manager. Generic audit và log lỗi SQL không nhận payload nguồn.

## Kiểm thử và phát hành

Migration mới `20261105025522_appsheet_customer_sync.sql` chỉ thêm cột/bảng/index; không sửa migration cũ. Chạy migration/test trên database thử trước.

```bash
npm run typecheck
node --import tsx --test tests/app/appsheet-customers.test.ts tests/app/appsheet-export.test.ts
npm test
```

Test dùng dữ liệu giả và PGlite với migration thật. `TEST_PG_URL` chỉ trỏ PostgreSQL thử riêng để kiểm tra nhiều kết nối; không dùng production. Trước nhập thật cần đối chiếu tổng nguồn/nhập/bỏ qua/xung đột và mẫu Key/Ref, MST, ngày, duyệt, liên hệ chính. Duyệt PR không tự cấp quyền migration/import production hoặc bật job đồng bộ.
