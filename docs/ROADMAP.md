# Lộ trình xây dựng lại

Nguyên tắc: **mỗi bước kết thúc bằng test xanh**, app cũ vẫn chạy song song cho tới khi cắt chuyển.
Ký hiệu: ✅ xong · ⬜ chưa làm. "Xong" nghĩa là đạt hết mục *Tiêu chí xong* của giai đoạn.

## Giai đoạn 0 – Khảo sát & nền tảng dữ liệu ✅

- ✅ Đọc toàn bộ dự án cũ, lập baseline test (229 test: 212 pass, 17 fail – xem *Nợ kỹ thuật bản cũ*).
- ✅ Tách schema cũ (37 bảng) thành 9 module, giữ nguyên từng cột.
- ✅ Hợp thức hoá 5 bảng bản cũ tạo ngầm lúc chạy.
- ✅ Thêm 13 bảng mới thay cho dữ liệu đang nằm trong JSON/R2 (catalog, tồn kho, đơn NCC, dòng hàng báo giá...).
- ✅ Migration `0000_init.sql` (55 bảng) và 18 test: migration, tương thích bản cũ, ràng buộc, kiến trúc.

## Giai đoạn 1 – Lõi hạ tầng (`src/core`) ✅

- ✅ `core/errors`: `AppError` + helper (400/401/403/404/409).
- ✅ `core/money`: `roundVnd`, `toFinite`, `clampPercent`.
- ✅ `core/http/router`: pattern `/quotes/:id`, **tiền tố** (`/api/staff`), `env` truyền vào handler, chốt `beforeAll` (Origin/phương thức) và chốt `authorize` chạy **trước mọi handler**, `requireMeta` (route không khai báo khu vực thì không đăng ký được), chặn đăng ký trùng. `readJson` giữ nguyên mã lỗi và thông báo bản cũ (415/400/413, chặn ngay khi đọc luồng).
- ✅ `core/http/security`: kiểm Origin cho mọi yêu cầu không phải GET, chỉ nhận GET/POST/PUT/DELETE.
- ✅ `core/auth/password`: PBKDF2 tương thích hash đang lưu; hash giả khi thiếu tài khoản có cùng số vòng với hash thật.
- ✅ `core/db`: `AnyDb` (Drizzle trên D1), `createDb(d1, schema)` — `core` không import module nào; `enumCheck`.
- ✅ Test: `tests/helpers/d1.ts` giả lập D1 trên `node:sqlite` đủ trung thực để chạy đúng đường `drizzle-orm/d1` (`.all()`/`.raw()`/`batch` nguyên tử). Cần Node ≥ 22.22.
- Phiên đăng nhập nằm ở module `staff` (Giai đoạn 2).

## Giai đoạn 2 – Module `staff` 🟡 làm dở
- ✅ **Xác thực** (`staff/api/auth-routes.ts`, `repo/auth-repo.ts`, `domain/session.ts`): xem liên kết kích hoạt, kích hoạt, đăng nhập, `/me`, đăng xuất, đổi mật khẩu, chặn thử mật khẩu (10/email, 100/IP, 10/đổi mật khẩu, cửa sổ 15 phút, đếm nguyên tử bằng một câu upsert), phiên 30 ngày chỉ lưu băm. Đối chiếu **trực tiếp với `staffApi` của bản cũ** (chạy trên D1 giả) ở 7 kịch bản: mã trạng thái, nội dung, cookie, và trạng thái DB cuối kịch bản giống hệt.
- ✅ **Cổng khu vực** gắn vào router: mọi route khai báo `Area`; NCC chỉ qua `self` + `supplier-portal`, đi sai nhận đúng 403 và thông báo của bản cũ; test duyệt toàn bộ route đã đăng ký.
- ✅ `domain/roles.ts`, `domain/area-policy.ts` (kể cả khu vực `public`).
- ✅ **Quản lý nhân viên** (Manager, khu vực `admin`): danh sách, tạo, sửa, khoá, cấp lại liên kết kích hoạt, đổi số điện thoại (`api/member-routes.ts`, `repo/member-repo.ts`, `domain/members.ts`). Vai trò luôn suy từ chức vụ; liên kết kích hoạt 15 phút; không tự đổi quyền/khoá/xoá/đặt lại chính mình; sửa/khoá/đặt lại đều huỷ phiên của người đó trong cùng một lô. Đối chiếu với `staffApi` bản cũ trên 7 kịch bản (mã trạng thái, thông báo, DB cuối kịch bản giống hệt); 10 phép phá thử đều bị bắt.
  - Khác bản cũ có chủ đích: thiếu `id` trong yêu cầu → bản mới trả 404, bản cũ trả **lỗi 500** (D1 từ chối giá trị `undefined`, che mất lỗi nhập liệu). Có test ghi nhận khác biệt này.
- ✅ **Chức vụ mặc định + Manager đầu tiên**: migration `0002_seed_positions.sql` (khớp `DEFAULT_POSITIONS`, có test) và `npm run bootstrap:manager` (xuất SQL + liên kết kích hoạt 24 giờ; test chạy thật script, áp SQL, kích hoạt, đăng nhập, vào trang quản lý).
- ⬜ Đồng bộ nhân viên với Sapo (`staff_sapo_links`, `staff-sync`, `staff-identity`, `staff-roster`).
- ⬜ Lắp ráp (`src/app`): worker nhận binding D1, tạo `createDb`, gắn `createStaffRouter()` vào vinext/Cloudflare Worker, chuyển hướng trang theo `pageRedirect`.
- Khác bản cũ có chủ đích (xem `tests/legacy/staff-auth.legacy-diff.test.ts` cho phần giống hệt): đường dẫn không tồn tại trả 404 *trước* khi kiểm phiên (bản cũ trả 401 trước); sai phương thức trên route có sẵn trả 405 kèm `Allow` (bản cũ rơi xuống kiểm phiên).

## Giai đoạn 3 – Module `quotes` (lõi) ⬜
1. ✅ `domain/quote-math.ts`: port `public/quote-math.js` (tính dòng, VAT theo dòng/chung, chiết khấu, phí in, lợi nhuận, giá vốn theo thương hiệu). Đã đối chiếu bản cũ/mới trên 5.000 ca ngẫu nhiên, giống hệt từng bit (`tests/quote-math.legacy-diff.test.ts`).
2. ✅ `domain/quotation-schema.ts` (`cleanQuotation`): port nguyên văn `validateQuotation` bản cũ – hàng rào chặn dữ liệu rác (NaN, chuỗi thay số, âm, quá lớn, ảnh không HTTPS, ngày không tồn tại) trước khi vào `quote-math`. Đối chiếu trực tiếp hàm cũ trên 6.000 báo giá ngẫu nhiên (cùng nhận/từ chối, mã lỗi, thông báo, dữ liệu sạch; chạm >25 loại lỗi) + test ngưỡng kích thước từng byte; 14 phép phá thử đều bị bắt. `validDeliveryDate` giống bản cũ trên 4.000 mẫu ngày.
2b. ✅ `domain/quote-index.ts`: cột tìm kiếm (`search_text`, `quote_date`, `contract_*`) và dòng hàng chuẩn hoá cho `quote_lines`; bất biến "tổng tiền/lợi nhuận từ các dòng chuẩn hoá == từ báo giá gốc".
3. `repo`: lưu báo giá = ghi `staff_quotations.data` + `quote_lines` + `quote_revisions` **trong một giao dịch**. *Test:* sửa → revision tăng; xung đột revision bị từ chối.
4. ✅ `domain/access.ts` (xem/sửa/chia sẻ/đổi người phụ trách, chặn NCC, kèm câu SQL lọc) và `domain/assignment.ts` (`planReassignment`, `planShare`, `assignableStaff`). Test đối chiếu hàm thuần với SQL trên mọi tổ hợp; 8 phép phá thử đều bị bắt.
5. `api`: danh sách, chi tiết, tạo, sửa, duyệt, đếm chờ duyệt, tổng kết giao hàng/lợi nhuận; **đổi người phụ trách** (`PUT /quotes/:id/assignee`, ghi `audit_logs`, danh sách chọn lấy từ `assignableStaff`; API phải truyền cho `planReassignment` danh bạ nhân viên để biết người đang phụ trách còn hợp lệ không); **chia sẻ** (`POST/DELETE /quotes/:id/shares`, chỉ chủ báo giá/manager, người nhận chỉ xem). Câu `UPDATE` báo giá phải kèm `quotationEditScope` để chặn sửa vượt quyền ngay ở DB. *Test:* người nhận quyền `edit` sửa được nhưng không chia sẻ tiếp/thu hồi được; quyền `view` thì không sửa được; thu hồi có hiệu lực ngay; khoá tài khoản thì mất quyền; hai người sửa cùng lúc → người lưu sau nhận 409.
6. `followup`: công nợ đơn Sapo (`quote_order_followups`) – ghi một lần cho mỗi báo giá (idempotent).
- *Tiêu chí xong:* mọi test `quote-math`, `quotation-store`, `quotation-profit`, `quotation-delivery`, `quote-order-followup` bản cũ có bản tương đương xanh.

## Giai đoạn 4 – Module `catalog` ⬜
1. Port validate `sapo-catalog-v1` thành zod.
2. `repo.replaceCatalog`: nạp sản phẩm/giá/tồn vào bảng trong một giao dịch, đánh dấu `catalog_versions.is_current`.
3. `domain/stock`: gộp tồn kho + `product_edits` + hàng chờ về (hiện nằm trong `readCatalog`, ~70 dòng dày đặc).
4. Nhập tồn kho từ file → `stock_imports` + `stock_import_lines`; OCR phiếu nhập.
5. **Công cụ chuyển dữ liệu R2 → bảng** (xem Giai đoạn 10).
- *Tiêu chí xong:* với cùng một file catalog, kết quả đọc của bản mới bằng bản cũ (so snapshot).

## Giai đoạn 5 – Module `customers` ⬜
Tìm khách (kể cả fallback Sapo), tạo khách nội bộ, đồng bộ từ Sapo, chiết khấu theo thương hiệu (`customer_brand_discounts`), hồ sơ HĐKT.

## Giai đoạn 6 – Khung giao diện (React + shadcn/ui) ⬜
1. Chuyển `components/ui` (shadcn đã có) sang `src/shared/ui`, giữ nguyên.
2. Layout + điều hướng theo vai trò (nhân viên / manager / NCC), mobile-first (bản cũ có thanh điều hướng dưới).
3. Trang theo module: `quotes` (danh sách, trình soạn, **nút Chia sẻ**: chọn nhân viên hoặc chức vụ, xem/thu hồi), `customers`, `catalog`.
4. Thay dần `public/*.js` – mỗi màn hình chuyển xong thì xoá script cũ tương ứng.
- *Test:* component test cho trình soạn báo giá (tổng tiền hiển thị khớp `quote-math`), phím tắt F6/F7.

## Giai đoạn 7 – Module `contracts` ⬜
Đánh số (`contract_counters`), trạng thái, chuyển hợp đồng, 10 mẫu Word (`.docx`), xuất ZIP theo khách, dấu "web source". Port: `contract-number`, `contract-document`, `contract-detail`, `contract-transfer`, `contract-web-mark`, `contract-word-edit`.

## Giai đoạn 8 – `suppliers`, `printing`, `integrations`, `notifications` 🟡 làm dở
- ✅ **Bảng** (`suppliers`, `supplier_contacts`, `supplier_accounts`, `incoming_shipments`, `incoming_shipment_lines`, `incoming_shipment_files`, `supplier_stock_requests(+_lines)`) và **logic thuần của trang NCC** (`suppliers/domain`: danh mục, quyền xem, tổng tiền, bộ kiểm tra dữ liệu, máy trạng thái). Đối chiếu trực tiếp với code bản cũ trên >25.000 ca máy trạng thái, 9.000 ca dữ liệu ngẫu nhiên và 3.000 đơn tính tiền (`tests/legacy/`).
- ⬜ API, ghi D1 trong giao dịch, upload/tải file R2, thông báo; giao diện hai màn hình – xem `docs/NCC-PAGE.md`.
- Đặc tả chuyển dữ liệu: `docs/INCOMING-STOCK-MAPPING.md`. Gồm cổng NCC (khu vực `supplier-portal`, chỉ tài khoản NCC và manager vào) và phần quản lý NCC phía công ty (`ncc-admin`, chỉ manager). Thay email NCC viết cứng trong code bằng dữ liệu (xem *Còn mở* #3). Quy trình đơn NCC: tạo → manager duyệt (nhập chiết khấu từng mã) → NCC xác nhận/ký → yêu cầu & thanh toán cọc → báo sẵn sàng giao → nhập kho (đồng bộ tồn). Mỗi bước là một hàm thuần kiểm tra điều kiện chuyển trạng thái + test; thay cơ chế ghi cả file index theo ETag bằng giao dịch D1.
Đơn NCC + cổng NCC (xác nhận, ký, đặt cọc), xưởng in, Sapo (đơn, hàng nhập, giám sát kết nối), Lalamove, Web Push. Mỗi tích hợp đứng sau một **interface** để test bằng giả lập.

## Giai đoạn 9 – `crm`, `work` ⬜
Công việc CRM, bản sao AppSheet VIGIFTS, báo cáo ca/tiền mặt. Hai module này gần như độc lập nên làm sau cùng.

## Giai đoạn 10 – Chuyển dữ liệu & cắt chuyển ⬜
0. **Hành động của anh (cần tài khoản Cloudflare):** tạo D1 mới (`wrangler d1 create`), khai báo binding trong `wrangler.jsonc`, tạo bucket R2 mới hoặc dùng chung bucket cũ ở chế độ chỉ đọc.
1. Script ETL idempotent: D1 cũ → D1 mới (bóc `discounts` JSON, catalog/tồn kho/đơn NCC từ R2 theo `docs/INCOMING-STOCK-MAPPING.md`, chuỗi chia sẻ báo giá `SỐ-BG:chức-vụ` → `quote_shares`, dựng `quote_lines` từ `data`, điền cột công nợ).
2. Chạy ETL trên **bản sao** dữ liệu thật; đối chiếu số lượng bản ghi và tổng tiền báo giá cũ/mới.
3. Chạy song song (bản mới chỉ đọc) một thời gian; so sánh kết quả.
4. Cắt chuyển theo từng module, có đường lui.
5. Dọn: xoá `public/*.js` cũ, `lib/*.mjs`, 12 MB snapshot trong source.

## Quyết định đã chốt (05/10/2026)
1. **Quyền báo giá:** nhân viên chỉ thấy và sửa báo giá do chính mình tạo. Bản cũ cho cùng chức vụ thấy nhau – đã bỏ ở cả xem lẫn sửa.
2. **Bỏ cột JSON `discounts`** của khách hàng, thay bằng bảng `customer_brand_discounts`.
3. **Cắt chuyển bằng D1 mới + ETL** (dễ lùi lại; D1 cũ giữ nguyên làm nguồn).
4. **Repo cũ giữ public** (quyết định của chủ dự án). Lưu ý: không đưa dữ liệu thật vào repo mới.
5. **Nút Chia sẻ:** có, do chủ báo giá chủ động bấm; chia sẻ cho từng nhân viên hoặc cả chức vụ (bảng `quote_shares`). **Người nhận được XEM và SỬA** (mặc định `permission='edit'`); chủ báo giá có thể chọn `view` để chỉ cho xem. Người nhận không chia sẻ tiếp/thu hồi được. Nếu khớp nhiều dòng chia sẻ thì quyền cao nhất thắng. Cấu hình chia sẻ theo chuỗi của bản cũ chuyển thành các dòng `quote_shares` với `permission='view'` (bản cũ chỉ cho xem).

6. **Chủ báo giá không bao giờ đổi** dù có người khác cùng làm (chặn bằng trigger DB, migration `0001`). Muốn người khác lo thì dùng **người phụ trách** (`staff_quotations.assignee_id`, chọn từ danh sách nhân viên hợp lệ; null = chủ). Người phụ trách xem và sửa được và **được ưu tiên**:
   - báo giá **chưa giao** (chủ đang là người phụ trách): chủ giao được cho người khác;
   - báo giá **đã giao**: chủ KHÔNG đè lên được, **chỉ Manager đổi được** (kể cả giao lại cho chính chủ);
   - người phụ trách hiện tại không tự giao lại hay chia sẻ;
   - tránh bế tắc: nếu người đang phụ trách bị khoá hoặc chuyển sang NCC thì chủ giao lại được;
   - danh sách chọn **không gồm NCC và người bị khoá**; mọi lần đổi ghi `audit_logs`.
   (Khác với `careAssigneeId` của bản cũ – người phụ trách *chăm sóc khách*, giữ nguyên ở giai đoạn CRM.)
7. **Tài khoản NCC (vai trò hoặc chức vụ `supplier`) chỉ vào được trang NCC** (cổng NCC + tài khoản cá nhân). Không xem được báo giá, khách hàng, sản phẩm... kể cả báo giá của chính mình hay được chia sẻ. Dữ liệu lệch (vai trò nhân viên nhưng chức vụ NCC) vẫn bị coi là NCC.
8. **Hai người cùng sửa một báo giá:** giữ khoá lạc quan theo `revision` như bản cũ (người lưu sau nhận 409 và tải lại, không ghi đè); mọi lần lưu ghi `quote_revisions.changed_by`.

9. **Danh mục NCC là dữ liệu** (bảng `suppliers`/`supplier_contacts`/`supplier_accounts`), sửa trên trang quản lý NCC; mỗi đơn NCC thuộc đúng một NCC; tài khoản NCC chỉ thấy đơn của NCC mình. Không còn email viết cứng trong code.

10. **Giữ nguyên như bản cũ** (chốt 05/10/2026): nhân viên thường thấy đơn NCC (ẩn giá); cho yêu cầu cọc trước khi NCC xác nhận (cờ `depositRequiresConfirmation` tắt); "đã tải mẫu về" thay được bước tải bản ký lên. Danh sách tài khoản NCC ↔ nhà cung cấp do script chuyển dữ liệu **tự suy ra như bản cũ** (khớp email + hai email "Minh Long") và liệt kê tài khoản không khớp để Manager gắn tay. Không cần file đơn NCC mẫu: script chạy thử (dry-run) trên dữ liệu thật và báo mọi điểm bất thường trước khi ghi.

## Còn mở – cần xác nhận
Hiện không còn câu hỏi chặn việc. Sẽ phát sinh khi làm: quản lý nhân viên (ai được đặt lại mật khẩu giúp người khác?), quy tắc đồng bộ nhân viên với Sapo, và kết quả dry-run chuyển dữ liệu (tên NCC viết khác nhau, tài khoản NCC không khớp).

## Nợ kỹ thuật phát hiện ở bản cũ
- Test bản cũ `visibility is shared only by assigned position` mâu thuẫn với test `shared visibility does not grant permission to overwrite`: bản cũ chủ ý cho cùng chức vụ XEM nhau nhưng không SỬA, trong khi code lại cho sửa. Quy tắc mới (#1) thay thế cả hai.
- 17/229 test fail trên bản cũ khi chạy nguyên trạng sau `npm ci`. Đã xác nhận 2 nguyên nhân: `miniflare` không nạp được trong môi trường này (test `vigifts-customer`) và lỗi thật ở `canEditQuotation` (mục 1). **15 test còn lại chưa phân loại** (nhóm `contract-web-mark`, `quote-shortcuts`, `rendered-html`, ...); sẽ phân loại khi port module tương ứng.
- `staff_notification_reads` không có khoá chính → đã sửa ở bản mới (khoá kép).
- Khoá chính TEXT khai báo kiểu `id TEXT PRIMARY KEY` cho phép NULL trong SQLite → bản mới đặt NOT NULL.
- Hai cặp migration trùng số (0014, 0023) và thiếu file snapshot drizzle.
- Tạo bảng ngầm lúc chạy (`CREATE TABLE IF NOT EXISTS` trong request) – 5 chỗ.
