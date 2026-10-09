# Thay AppSheet CRM bằng CRM web mới – hiện trạng & kế hoạch

> Kiểm tra ngày 09/10/2026 trên `main` (sau PR #58). Trang live https://crm.minhlongonline.com chạy đúng bản này
> (GitHub Actions "Triển khai giao diện" và "Triển khai API" đều xanh).

## 1. Tóm tắt hiện trạng

- **Nền tảng:**
  - Cloudflare Pages (giao diện `trial-ui/`, JavaScript thuần);
  - Supabase Edge Function `baogia-v2-api` (API) và PostgreSQL (97 bảng, migration `0000` → `0047`);
  - merge vào `main` thì tự test rồi triển khai.
- **Giao diện:**
  - không thiếu file nào: script, ảnh, font, mẫu Word, icon, manifest đều có;
  - mọi mục menu đều có màn hình xử lý;
  - API gọi cố định tới `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff` (trang nhân viên và trang khách dùng chung).
- **Luồng việc hằng ngày của AppSheet đã có đủ trên web mới**, gồm API, giao diện và test:

| Việc trên AppSheet | Trên CRM mới | Chỗ trong code |
|---|---|---|
| Khách hàng cần duyệt | ✅ Lọc "chờ duyệt", nút Duyệt; khách chưa duyệt thì chưa lên đơn được | `POST /customers/:id/approve`, `app.js` (reviewCustomer), `tests/app/approvals.test.ts` |
| Báo giá cần duyệt | ✅ Nhân viên tạo → chờ Manager duyệt; sửa bản đã duyệt → mất duyệt | `POST /quotes/:id/approve`, `GET /quotes/pending-count` |
| Đơn hàng / HĐKT cần duyệt | ✅ Luôn tạo ở trạng thái nháp, Manager duyệt (có danh sách kiểm tra); đã duyệt thì khoá báo giá | `PUT /orders/:id/status`, `POST /contracts` |
| Nhiệm vụ hôm nay | ✅ Quá hạn / Hôm nay / Sắp tới; việc tự sinh từ mọi luồng (duyệt, giao, đóng gói, công nợ, hoá đơn, chăm sóc khách) | `GET /tasks/summary`, `GET /tasks`, `tasks/api/auto-tasks.ts`, `trial-ui/tasks.js` |
| Phê duyệt | 🟡 Có ở từng màn hình, và được nhắc qua việc tự sinh + thông báo đẩy. **Chưa có một hộp "Cần duyệt" chung** như AppSheet | xem các dòng trên |
| Lịch sử / nhật ký | 🟡 Có lịch sử chăm sóc khách, lịch sử sản phẩm, lịch sử mua của khách, bản lưu báo giá (`quote_revisions`). **Bảng `audit_logs` có nhưng chưa ghi**; chưa xem được lịch sử sửa báo giá trên giao diện | `src/core/db/schema.ts`, `quotes/api/routes.ts` |
| Phân quyền | 🟡 Cố định trong code: 4 vai trò (manager, employee, supplier, customer) + khu vực truy cập; nhóm nhận việc Kho / Kế toán / Sale Admin. **Chưa có bảng phân quyền theo chức vụ để Manager tự chỉnh**; chưa có API sửa chức vụ | `staff/domain/roles.ts`, `area-policy.ts`, `tasks/domain/task-config.ts` |
| Chăm sóc khách / giao dịch | ✅ Form như AppSheet (loại giao dịch, kết quả, doanh số dự kiến, chăm sóc lần sau, nhắc trước) | `care/`, `trial-ui/care.js` |

- **Module `crm`** (`src/modules/crm/schema.ts`): chỉ có 9 bảng chép nguyên từ web cũ:
  - `crm_tasks`;
  - `vigifts_appsheet_apps / tables / fields / rows / views / actions / bots`;
  - `vigifts_product_image_map`.
  - Không có API, không có giao diện, không có code nào đọc / ghi; các bảng này đang trống.
  - `crm_tasks` đã được thay bằng module `tasks`.
- **Chưa có công cụ chuyển dữ liệu từ AppSheet** (Google Sheets) sang. Dữ liệu khách và sản phẩm hiện lấy từ Sapo và web cũ.

## 2. Lỗi / rủi ro theo mức độ

**Cao**
1. ~~**Chưa có nhật ký thay đổi (audit).**~~ → **Đã làm (M2, xem bên dưới).**
2. **Chưa có công cụ chuyển dữ liệu AppSheet.** Lịch sử giao dịch / chăm sóc khách, nhiệm vụ đang mở và hợp đồng đang chạy trên AppSheet chưa có đường sang hệ mới, nên chưa cắt chuyển được.

**Trung bình**
3. **Phân quyền viết cứng trong code.** Ví dụ Kế toán chưa xem được mọi công nợ. Muốn đổi quyền phải sửa code.
4. **Chưa có hộp "Cần duyệt" chung cho Manager.** Duyệt nằm rải ở từng trang; việc tự sinh và thông báo đẩy đang bù lại phần này.
5. **Web Push phụ thuộc secret `SAPO_SYNC_TOKEN`** (≥ 32 ký tự): thiếu thì không đẩy được. Đã có hộp "Kiểm tra thiết bị nhận thông báo" cho Manager (PR #55) để thấy lý do.
6. **Bảo mật HTTP:** đã bật HSTS (chỉ tên miền này) và **CSP ở chế độ chỉ báo cáo** (M1); còn phải xem báo cáo rồi mới chặn thật.

**Thấp**
7. **Bộ nhớ đệm:** mọi file đều `Cache-Control: no-cache`, nên thư viện lớn (pdf-lib, exceljs, font, mẫu Word ≈ 5 MB) được kiểm lại mỗi lần dùng. Có thể đặt `immutable` cho file đã gắn `?v=`.
8. ~~**Phóng to trên điện thoại**~~ → **đã cho phóng to** (bỏ `maximum-scale=1`, `user-scalable=no`); ô nhập trên điện thoại ≥ 16px để iPhone không tự phóng khi gõ. Màn nào vỡ khi phóng to thì sửa giao diện, không khoá lại.
9. **Module `crm` / `work`:** chỉ có bảng. **Quyết định 09/10: GIỮ LẠI** (đường thay AppSheet), đã ghi chú trạng thái ngay trong `schema.ts`; `crm_tasks` đánh dấu không dùng (thay bằng `tasks`). Không xoá.

## 3. Đã sửa trong lần kiểm tra này

| File | Sửa gì | Vì sao |
|---|---|---|
| `trial-ui/manifest.webmanifest`, `manifest-customer.webmanifest` | Thêm `id` (`index.html` / `customer.html`) | Định danh app cài trên máy (PWA) rõ ràng; giá trị bằng đúng định danh cũ nên máy đã cài không phải cài lại |
| `trial-ui/push-sw.js` | Bấm thông báo thì mở đúng cửa sổ: thông báo nhân viên mở ở tab nhân viên, thông báo khách mở ở tab khách | Trước đây cửa sổ đầu tiên tìm được bị điều hướng, có thể mở trang nhân viên trong tab trang khách |
| `.github/workflows/deploy-ui.yml` | Sửa `scripts/stamp-ui-version.ts` cũng kích hoạt triển khai giao diện | Trước đây sửa riêng script gắn phiên bản không triển khai lại |
| `scripts/gen-data-model-doc.ts`, `docs/DATA-MODEL.md` | Thêm các module sales, tasks, chat, care, hr, portal; sinh lại tài liệu (69 → 97 bảng) | Tài liệu thiếu 28 bảng đang dùng |
| `docs/ROADMAP.md`, `README.md`, `docs/BAN-HANG.md`, `docs/DONG-BO-SAPO.md` | Ghi đúng nền tảng (Supabase + Pages, JS thuần), các phần đã xong, danh sách tài liệu | Tài liệu cũ còn ghi D1/Workers/React và nhiều mục đã xong là "chưa làm" |

**Kiểm tra:**
- `npm test` và `npm run typecheck`;
- `npm run docs:data-model` ra đúng 97 bảng, khớp test migration;
- `node --check trial-ui/push-sw.js`;
- sau khi triển khai: mở trang, cài lại app (không bắt buộc), bấm một thông báo khi đang mở cả tab nhân viên lẫn tab khách.

**Quyết định của chủ dự án (09/10/2026):**
1. CSP: bật **chỉ báo cáo** trước, xem báo cáo rồi siết dần. HSTS: chỉ `crm.minhlongonline.com`, **không** `includeSubDomains`.
2. Cho phóng to trên điện thoại; màn nào vỡ thì sửa giao diện.
3. **Không xoá** `crm` / `work`; code chết hoặc lệch thì đánh dấu / tách, chưa xoá.
4. Danh sách bảng AppSheet: đọc từ bản sao `vigifts_appsheet_*` bằng `scripts/sql/appsheet-schema-report.sql` (chỉ cấu trúc + số dòng, không dữ liệu thật) → gửi chủ dự án duyệt.
5. Làm **M2 (nhật ký thay đổi) trước**, không đổi nghiệp vụ duyệt.

## 4. Lộ trình thay AppSheet (theo thứ tự ưu tiên)

### M1 – Sửa nhanh ✅
- ✅ Manifest `id`, thông báo mở đúng cửa sổ, điều kiện triển khai, tài liệu (mục 3).
- ✅ `Strict-Transport-Security: max-age=31536000` (không `includeSubDomains`).
- ✅ `Content-Security-Policy-Report-Only` (`trial-ui/_headers`):
  - trang tự gửi vi phạm về `POST /csp-report` (`trial-ui/csp-report.js`, chỉ khi đã đăng nhập, tối đa 20 vi phạm khác nhau mỗi trang);
  - máy chủ in ra log Edge Function, dòng `csp-report`.
  - Không dùng `report-uri` vì Edge Function chỉ nhận yêu cầu có Origin của trang.
  - **Việc tiếp:** xem log vài ngày, bổ sung nguồn hợp lệ, rồi đổi sang `Content-Security-Policy` (chặn thật).
- ✅ Cho phóng to trên điện thoại.
- ✅ `login.html` không còn script nội tuyến (`login-redirect.js`).
- Còn lại (không gấp): `Cache-Control: immutable` cho file có `?v=`.

### M2 – Nhật ký thay đổi ✅ (đã làm 09/10/2026)
- **Cách ghi:** tự động ở tầng router (`core/http/router.ts` → `onSuccess`, `core/audit.ts`, gắn trong `staff/api/auth-routes.ts`).
  - Mọi thao tác GHI **thành công** ở khu vực làm việc / quản trị / trang khách / NCC tạo một dòng `audit_logs`, gồm:
    - người làm (`actor_id`), khu vực (`module`);
    - `action` = "PHƯƠNG THỨC /route", ví dụ `PUT /orders/:id/status`;
    - loại bản ghi (đoạn đầu đường dẫn) và mã bản ghi (`:id` / `:sku`, hoặc `id` trả về khi tạo mới);
    - `data`: thân yêu cầu đã **che mật khẩu / mã bí mật**, **bỏ ảnh / file**, rút gọn chuỗi dài, tối đa ~6 KB.
  - Không ghi: thao tác lỗi, đọc dữ liệu, đăng nhập / đổi mật khẩu, tin nhắn, đánh dấu đã đọc, bật thông báo, tải ảnh hộ, báo cáo CSP.
  - Lỗi ghi nhật ký không làm hỏng thao tác chính. **Không đổi nghiệp vụ** nào.
- **API:** `GET /audit` (chỉ Manager), lọc theo:
  - `entityType` + `entityId` (`&related=1` kèm thao tác nhắc tới mã này, ví dụ phiếu thu / giao hàng của đơn);
  - `actorId`;
  - `before`;
  - không lọc = 100 thao tác gần nhất.
- **Giao diện:** nút **"Lịch sử"** (chỉ Manager) ở trang báo giá và trang đơn hàng (`trial-ui/audit-ui.js`), có tên thao tác dễ đọc.
- **Migration:** `0048_audit_log_created.sql` (chỉ mục theo thời gian).
- **Test:** `tests/app/audit.test.ts`.
- **Còn có thể thêm sau:**
  - nút Lịch sử ở trang khách hàng / sản phẩm;
  - xem so sánh các bản `quote_revisions`;
  - cho nhân viên xem lịch sử việc của mình.

Kế hoạch gốc của M2 (để đối chiếu):
- **Backend:** hàm `audit(env, { actor, entity, entityId, action, before, after })` ghi `audit_logs`, gọi ở:
  - duyệt / bỏ duyệt báo giá, đơn, HĐKT, khách hàng, sản phẩm;
  - đổi giá / số lượng, huỷ đơn, xoá báo giá;
  - đổi người phụ trách;
  - phiếu thu, sửa / huỷ phiếu đóng gói.
- **API:** `GET /audit?entity=&id=` (Manager; nhân viên chỉ xem bản ghi của việc mình).
- **Giao diện:** thẻ "Lịch sử" ở chi tiết báo giá / đơn / khách. Thêm xem lại `quote_revisions` (so sánh bản trước / sau).
- **Test:** mỗi thao tác trên ghi đúng một dòng; nhân viên không xem được nhật ký của người khác.

### M3 – Hộp "Cần duyệt" cho Manager
- **API:** `GET /approvals` gom báo giá, đơn, HĐKT, khách hàng và sản phẩm đang chờ duyệt, kèm số đếm.
- **Giao diện:** trang `#/approvals` (badge trên menu), duyệt nhanh từng dòng (vẫn qua hộp kiểm tra như hiện nay).
- **Test:** mỗi loại xuất hiện / biến mất đúng khi tạo / duyệt.

### M4 – Phân quyền theo chức vụ
- **Migration:** bảng `position_permissions (position_id, permission)`, danh mục quyền viết sẵn trong code. Ví dụ:
  - `receivables.view_all`;
  - `deliveries.view_all`;
  - `quotes.approve`;
  - `orders.approve`;
  - `customers.approve`.
- **API:**
  - Manager sửa chức vụ và quyền: `GET/PUT /admin/positions`;
  - các route đang kiểm `role === 'manager'` chuyển dần sang `can(member, 'quyền')`. Manager luôn có mọi quyền.
- **Giao diện:** ma trận Chức vụ × Quyền ở trang Nhân viên.
- **Test:** từng quyền mở / đóng đúng route. Test kiến trúc chặn route mới không khai báo quyền.

### M5 – Chuyển dữ liệu AppSheet (ETL)
1. Anh xuất các bảng AppSheet (Google Sheets → CSV) hoặc cho đọc sheet. **Không đưa file dữ liệu thật vào repo.**
2. Script `scripts/import-appsheet.ts`:
   - chạy được nhiều lần không sinh trùng (theo mã dòng AppSheet);
   - có chế độ chạy thử (dry-run) in báo cáo lệch;
   - ghi các bảng:
     - giao dịch / chăm sóc → `customer_activities`;
     - nhiệm vụ đang mở → `tasks`;
     - khách hàng → khớp `sapo_customers` theo MST / SĐT, khách không khớp đưa vào danh sách cho Manager xử lý;
     - hợp đồng / đơn đang chạy → `sales_orders` / `sales_contracts` (nếu cần).
3. Cần anh xác nhận danh sách bảng AppSheet và cột tương ứng; em lập bảng ánh xạ trong `docs/APPSHEET-MAPPING.md`.
4. Bảng `vigifts_appsheet_*` hiện có thể dùng làm vùng đệm (lưu dòng gốc `raw_json`) trước khi chuyển vào bảng chính, hoặc bỏ đi.
- **Test:** chạy hai lần không trùng; dòng lỗi được báo, không chặn cả lô; tổng số dòng / doanh số khớp với file nguồn.

### M6 – Chạy song song và cắt chuyển an toàn
1. **Tuần 1–2:**
   - AppSheet vẫn là nơi nhập chính;
   - mỗi ngày chạy ETL sang web mới (chỉ đọc), đối chiếu số khách chờ duyệt, nhiệm vụ hôm nay, doanh số dự kiến;
   - nhân viên thử thao tác trên web mới.
2. **Tuần 3:** chuyển nhập liệu sang web mới theo nhóm việc:
   - chăm sóc khách và nhiệm vụ trước (ít rủi ro);
   - rồi báo giá / đơn;
   - AppSheet chuyển sang chỉ xem (khoá sửa).
3. **Tuần 4:** chạy ETL lần cuối (chỉ những dòng mới), tắt quyền sửa AppSheet, giữ bản xuất làm lưu trữ.
4. **Đường lui:** trong 2 tuần đầu sau cắt chuyển vẫn giữ AppSheet chỉ xem. Nếu có sự cố thì mở lại sửa trên AppSheet và chạy ETL ngược phần mới phát sinh (cần viết thêm nếu chọn phương án này).
5. **Dọn dẹp:** xoá module `crm` / `work` nếu không dùng; bỏ bảng `vigifts_appsheet_*` bằng migration mới (không sửa migration cũ).

### Test cần thêm (đi kèm từng mốc)
- M2: test ghi nhật ký cho từng thao tác + quyền xem nhật ký.
- M3: test hộp Cần duyệt.
- M4: test ma trận quyền cho mọi route nhạy cảm.
- M5: test ETL với file mẫu giả (không dùng dữ liệu thật).
- Chung: test giao diện tự động (Playwright) cho các luồng chính trên khung điện thoại:
  - đăng nhập;
  - tạo báo giá → duyệt → đơn → giao → thu tiền;
  - ghi giao dịch chăm sóc;
  - nhận / hoàn thành việc.
