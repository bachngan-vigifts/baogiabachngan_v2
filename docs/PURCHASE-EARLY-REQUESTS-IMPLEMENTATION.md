# Xin lấy trước nhiều mã — triển khai và kiểm chứng

Ngày: 21/10/2026 (Việt Nam). Tiếp nối phần đọc đã merge trong PR #205. Đã duyệt tạo 3 bảng và duyệt riêng thêm 5 cột cho phiếu nháp. **Chưa chạy migration lên DB CRM, chưa deploy, chưa kiểm cổng NCC production.**

## Luồng cuối cùng

Chọn nhiều mã và nhập SL → “Lưu và gửi NCC” mở phiếu nháp → nhập ngày lấy, “Lưu nháp” → có thể mở lại/sửa SL/ngày lấy → “Gửi NCC”. Phiếu nháp chưa hiện cho NCC. Khi gửi, máy chủ kiểm lại lượng còn về và phân bổ ngày hẹn sớm nhất trước; trạng thái hiển thị “Chờ NCC xác nhận”. NCC chỉ đồng ý/từ chối từng SKU thuộc phần của mình; Manager/Sale Admin không duyệt thay.

Nháp là phiếu xin lấy trước, không phải đơn mua mới. Không cộng trùng hàng đang về, không đặt giữ/trừ tồn, không tạo phiếu nhận/chi tiền, không gắn đơn khách. Lưu/gửi/phản hồi đều có audit trong cùng transaction. Request lặp cùng key/cùng nội dung trả lại cùng phiếu; khác nội dung trả 409. Sửa nháp dùng revision; gửi và phản hồi lặp không ghi lại nghiệp vụ.

Nhập vượt lượng có viền đỏ, aria-invalid, lỗi ngay cạnh ô và thông báo ở thanh cuối; nút bị khóa khi có dòng sai. Máy chủ cũng chặn vượt và rollback cả phiếu nếu một dòng sai, kể cả khi số còn về thay đổi sau lúc xem.

## Migration đã được duyệt tạo (chưa chạy live)

1. `20261021063222_purchase_early_requests.sql`: 3 bảng header/lines/allocations, PK/FK, unique idempotency, kiểm quantity/status, index, RLS.
2. `20261021063421_supabase_access_purchase_early_requests.sql`: REVOKE cả PUBLIC/anon/authenticated; không mở policy đọc trực tiếp.
3. `20261021064101_purchase_early_request_drafts.sql`: header status draft/submitted, pickup_date, scope, updated_at, revision. Giá trị mặc định submitted giữ nghĩa dữ liệu gửi trước khi có nháp. Không thay RLS/quyền cũ.

Ngày lấy không sửa ngày hẹn gốc trên đơn mua. SKU không FK catalog để mã Excel không bị loại. Các bảng xin hàng cũ giữ nguyên. Chi tiết schema/phê duyệt: `PURCHASE-EARLY-REQUESTS-SCHEMA.md`.

## Route, link, action và automation

| Phần | Kết quả kiểm |
|---|---|
| `GET /purchase-incoming` | Dùng helper chung, tổng trước phân trang; thêm kiểm quyền page.purchases cho endpoint mới, không mở rộng quyền |
| `GET /purchase-early-requests` | Nội bộ giữ quyền trang mua; có lọc NCC/id; tải đủ các dòng của 50 header, không cắt ngang phiếu |
| `POST /purchase-early-requests` | Lưu nháp nhiều mã, unique theo người tạo+key, hash nội dung; kiểm số nguyên và lượng thực tế, audit đầy đủ |
| `PUT /purchase-early-requests/:id` | Chỉ nháp, Manager/Sale Admin; revision, giữ phạm vi NCC/ngày, lưu lại ngày lấy/SL |
| `POST /purchase-early-requests/:id/submit` | Đọc lại số còn về sau khóa đơn mua tương thích khóa nhận hàng/hủy; bắt buộc ngày lấy hợp lệ; gửi lặp không tạo phiếu khác |
| `GET /supplier-portal/early-requests` | NCC chỉ phần được gắn qua supplier_accounts và NCC active; nháp không hiện, không lộ tổng/SKU/NCC khác. Manager chỉ xem phiếu đã gửi |
| `POST /supplier-portal/early-requests/:id/respond` | NCC của SKU phản hồi phần mình, atomic theo SKU/NCC; lặp cùng phản hồi an toàn, đổi phản hồi đã chốt 409; Manager/SA bị từ chối |
| Chi tiết đơn mua | Link đúng ID, giữ `mode=incoming`; instance giữ bộ lọc/lựa chọn khi quay lại; server giữ purchaseScope |
| Chi tiết NCC | Deep link `#/suppliers/:id` mở đúng NCC; chỉ hiện link khi được quản lý danh bạ; danh bạ hiện phiếu của NCC nếu người xem có page.purchases |
| Tra tồn | Link `#/stock-lookup?q=SKU` điền đúng mã; chỉ hiện theo quyền menu hiện tại, không đổi công thức tồn |
| Phiếu nháp | Deep link `#/purchases?mode=incoming&request=ID` mở phiếu đúng ID cho người được sửa, người khác đọc; không tự gửi |
| Cổng NCC | `supplier.html?request=ID`, dùng phiên đăng nhập hiện có; chỉ Manager xem đối chiếu, NCC phản hồi phần mình; login NCC từ trang chính chuyển sang cổng |
| Task tự sinh / cron / Sapo | Không thêm hook task/cron/Sapo. Test đếm tasks/receipts/payments không đổi sau gửi; không tạo việc kho/trả NCC trùng |

## Quyền

| Vai trò | Xem nội bộ | Lưu/sửa/gửi | Cổng / phản hồi |
|---|---|---|---|
| Manager | Có | Có | Xem, không phản hồi thay |
| Sale Admin | Theo page.purchases | Có, nếu còn quyền trang | Không vào cổng thay NCC |
| Sale / Kho / Kế toán | Giữ page.purchases hiện tại | Không | Không |
| NCC | Không | Không | Chỉ NCC mình được gắn và active; không thấy nháp |
| Chưa login / bị thu hồi quyền trang | 401 / 403 | Bị chặn | Theo session và area hiện tại |

Test thu hồi page.purchases chặn cả API tổng hợp và danh sách yêu cầu; không chỉ ẩn UI. Không thêm quyền mới hay đổi định nghĩa Sale Admin.

## Đối chiếu dữ liệu

| SKU | Gốc | Helper mới | Số đơn production |
|---|---:|---:|---:|
| 031106000 | 20.000 | 20.000 | 2 × 10.000 |
| 01654020803 | 10 | 10 | 1, mã Excel ngoài catalog |
| 042513000 | 13.000 | 13.000 | 5 |
| 031199000 | 11.600 | 11.600 | 4 |
| 022505000 | 9.000 | 9.000 | 4 |

Bảng gốc từ SQL chỉ đọc trong preflight; lượng được tái dựng trong fixture thử nghiệm. Fixture riêng dùng đúng 031106000 trong 3 đơn 8.000+7.000+5.000; API trả 20.000, mở ra đủ 3 đơn. Không sửa production để khớp mockup. Đơn hủy/nháp/nhận đủ bị loại; phiếu nhận hủy và hàng hỏng không bị trừ sai. Excel có event import và không có nguồn được gắn nhãn, không suy ra import chỉ từ thiếu nguồn.

## Kiểm thử

- Typecheck/UI build đạt.
- Full suite: **737 test, 707 pass, 0 fail, 30 skip**. Skip do không có repo legacy cho đối chiếu cũ. Sau đó bổ sung hiển thị phiếu ở danh bạ NCC và link cổng, kiểm hồi quy riêng: **8 pass, 0 fail, 0 skip**; typecheck cuối đạt.
- Các test mới: gửi nhiều mã/phân bổ/không tác động task-tồn-chi; validate/quyền/rollback; NCC scope/phản hồi/audit; nháp/ngày lấy/revision/đọc lại lượng khi gửi; bấm đúp đồng thời cùng key; RLS/revoke; schema migration.
- Chromium với router và DB PGlite thật, không dùng response lưu giả: **1440,1280,390px đạt** đọc, cảnh báo đỏ khi vượt, chọn 2 SKU, mở 3 đơn, đúng link NCC/Tra tồn, lưu nháp, sửa ngày lấy, lưu revision mới, gửi riêng và không tràn viewport. Cổng NCC lưu được phản hồi thật trên DB thử nghiệm, chỉ thấy SKU của NCC mình.
- Kiểm thử live mới chỉ SQL đọc preflight. Chưa áp dụng migration/đăng nhập NCC production/gửi yêu cầu production. Không gọi Sapo, không kiểm máy in.

## File thay đổi

- Schema/API: `src/modules/suppliers/early-request-schema.ts`, `api/early-request-routes.ts`, `api/incoming-by-sku.ts`, `api/incoming-stock.ts`, `api/purchase-routes.ts`, `api/directory-routes.ts`; `src/db/schema.ts`, `src/app/router.ts`, `src/modules/staff/domain/permissions.ts`.
- UI: `trial-ui/purchase-early-requests.js`, `purchase-incoming.js`, `purchases.js`, `supplier.html`, `supplier-portal.js`, `suppliers.js`, `kho.js`, `app.js`, `style.css`.
- Test: `tests/helpers/purchase-early-fixture.ts`, `tests/app/purchase-early-requests.test.ts`, `purchase-incoming.test.ts`, `tests/db/purchase-early-access.test.ts`, `migration.test.ts`.
- Ba migration nêu trên; `docs/PURCHASE-EARLY-REQUESTS-SCHEMA.md` và tài liệu này.

Các mục [CHƯA CHỐT] giữ đúng mặc định prompt: không cho vượt số còn về; Sale Admin không duyệt thay NCC; vai trò xem giữ quyền hiện tại, chưa mở thêm vai trò. Chưa có quyết định khác để tự đổi các mặc định này. Vẫn cần phê duyệt riêng bước chạy 3 migration lên DB CRM trước triển khai.
