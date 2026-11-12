# Cổng NCC — hồ sơ duyệt giao diện

**Cập nhật:** đã bổ sung cổng API dữ liệu thật và giao diện production trong cùng PR. Tài liệu này ghi nhận giai đoạn duyệt mẫu; trạng thái hiện tại và thứ tự triển khai nằm tại [NCC-LIVE-DATA.md](NCC-LIVE-DATA.md).

Ngày: 12/11/2026. Nền mã đã đọc: `origin/main` tại `7094a6a7`.

Bổ sung kiểm thử trước triển khai: [NCC-PREDEPLOY-TEST-REPORT.md](NCC-PREDEPLOY-TEST-REPORT.md), gồm tình huống bất lợi, lỗi đã tái hiện/sửa, đo trước/sau và giới hạn của bản duyệt.

## Phạm vi bàn giao lần này

- Đã sửa form đăng nhập NCC thực tế, dùng bố cục/CSS xác thực của form nhân viên; thêm hiện mật khẩu, chống gửi trùng và tích hợp Turnstile hiện có. Không thay API đăng nhập, phiên đăng nhập hoặc quyền.
- Đã dựng bản tương tác **ngoại tuyến, dữ liệu giả** cho 10 trang. Chưa nối API nghiệp vụ mới. Mọi xác nhận trong bản duyệt chỉ hiển thị kết quả xem trước.
- Chưa merge, deploy, tạo migration, gửi email thật hoặc thay đổi dữ liệu production. Chờ anh Thái duyệt giao diện theo yêu cầu trước khi thực hiện các đợt nối dữ liệu.
- Bản duyệt nằm trong `design/supplier-workspace/`, ngoài thư mục deploy `trial-ui/`. Không đưa dữ liệu mẫu lên CRM thật.

## Cách xem

```bash
node scripts/review-supplier-workspace.mjs
# http://localhost:4175/#overview
# http://localhost:4175/#login
```

Có thể sinh một file mở độc lập bằng `node scripts/testing/supplier-review-portable.mjs`; file `ban-tuong-tac.html` trong bộ bàn giao không cần server, dùng dữ liệu giả và form đăng nhập chỉ xem thử.

Chọn menu để chuyển trang; mở bộ lọc chi tiết; bấm mã chứng từ để xem chi tiết/liên kết; chọn hành động để xem thử biểu mẫu. Xuất danh sách là CSV theo bộ lọc, ghi rõ MINH-HOA-NCC trong tên file. Form đăng nhập xem thử không gửi thông tin đến production.

## Các trang và bộ lọc

Mỗi danh sách có tìm kiếm, trạng thái, lọc ngày, xóa bộ lọc, thống kê theo kết quả lọc, phân trang 8/16/32, xuất CSV và chi tiết. Bộ lọc được giữ theo trang và URL; không tải lại toàn trang khi gõ tìm kiếm.

| Trang | Nội dung | Bộ lọc bổ sung |
|---|---|---|
| Tổng quan | Việc chờ phản hồi, đơn mới, lịch giao, công nợ | Tháng này / 7 ngày / tất cả; công nợ ghi riêng thời điểm đối chiếu |
| Sản phẩm | Mã, tên, quy cách, thương hiệu, giá theo đơn gần nhất; bảng/thẻ | Thương hiệu, nhóm, kho, khoảng giá |
| Kiểm tồn | Tồn NCC công bố, đã phân bổ, có thể giao, sắp bổ sung | Thương hiệu, kho, khoảng SL có thể giao, tình trạng tồn |
| Đơn đặt hàng | Số CRM và số nội bộ NCC, SL, hẹn giao, giá trị, phần còn thu | Kho, khoảng tiền, ngày đặt/ngày hẹn |
| Phiếu xin hàng | Phần phân bổ cho NCC, số xin, đã giao, ngày hẹn, phản hồi | Kho, ưu tiên, ngày lập/ngày lấy |
| Điều chuyển | Chiều hàng, nơi xuất/nhận, số lượng, xác nhận | Kho/nơi xuất, chiều hàng, khoảng ngày |
| Tạm ứng | Đề nghị công ty ứng/cọc theo đơn; trạng thái xử lý | Kho, khoảng tiền, ngày đề nghị/ngày mong muốn |
| Công nợ | Giá trị đơn, tiền đã nhận, giảm trừ, còn thu, quá hạn | Ngày đối chiếu, kho, khoảng tiền còn thu |
| Hóa đơn | Số hóa đơn, ký hiệu, đơn gốc, tiền hàng/VAT, đối chiếu | Kho, ký hiệu, khoảng tiền |
| Phiếu giao hàng | Số phiếu NCC và số phiếu nhận CRM riêng, SL, hóa đơn | Kho, nơi nhận, ngày lập/ngày hẹn |

Thiết kế dùng sidebar trên máy tính, menu và thanh nhanh trên điện thoại. Tên sản phẩm nằm ở hàng rộng đầy đủ trên mobile; không ép chung cột với số tiền. Chi tiết có vùng cuộn riêng, giữ nút đóng và thao tác trong màn hình.

## Đối chiếu cấu trúc và nguồn dữ liệu

Các kết luận dưới đây là từ code/schema, **không phải xác minh dữ liệu production**.

| Mục | Nguồn đang có và bằng chứng | Phần cần làm sau khi duyệt |
|---|---|---|
| Tài khoản và phạm vi NCC | `supplier_accounts` gắn nhân viên với NCC: `src/modules/suppliers/schema.ts:55`; ánh xạ kiểm tra NCC hoạt động: `src/modules/suppliers/api/early-request-routes.ts:27` | Tái dùng kiểm tra ánh xạ ở mọi API mới; không nhận supplierId tùy ý từ browser |
| API cổng NCC hiện tại | GET danh sách và POST phản hồi tại `src/modules/suppliers/api/early-request-routes.ts:320` và `:325` | Chỉ có hai endpoint nghiệp vụ này được đăng ký với area supplier-portal trong các route đã rà soát; comment mô tả rộng hơn không chứng minh chức năng đã có |
| Phiếu xin hàng | `earlyRequestList` lọc phân bổ ngay trong SQL, chỉ trả phần của NCC: `src/modules/suppliers/api/early-request-routes.ts:84`, `:100` | Tái dùng luồng phản hồi; bổ sung bộ lọc/phân trang phía server theo hợp đồng rõ ràng |
| Đơn mua | `incoming_shipments` và dòng hàng: `src/modules/suppliers/schema.ts:77`, `:170`; số đơn NCC `:95`, xác nhận `:96` | API danh sách/chi tiết chỉ đơn được phép gửi đúng NCC; không trả note nội bộ (`:141`), nguồn khách, đơn NCC khác hoặc toàn bộ object DB |
| Giá trị đơn | Hàm nghiệp vụ `computeOrderTotals`: `src/modules/suppliers/domain/order-totals.ts:28`; view hiện tại dùng hàm này: `src/modules/suppliers/api/purchase-store.ts:82` | Tái dùng hàm backend này; không dùng công thức minh họa 8% trong prototype cho production. VAT, CK và phí in phải theo từng dòng hiện có |
| Thanh toán/công nợ | `supplier_payments`: `src/modules/suppliers/schema.ts:384`; hủy chứng từ `:401`; lịch trả `:367`; view tổng hợp `src/modules/suppliers/api/purchase-store.ts:60` | API chỉ đọc chứng từ của đúng đơn/NCC; tái dùng quy tắc công nợ hiện hành. Không cộng `paid_amount` lần nữa với ledger. Chốt quy tắc số dư lịch sử/giảm trừ trước khi triển khai |
| Tạm ứng | Tỷ lệ cọc, yêu cầu cọc, thời điểm thanh toán có trên đơn: `src/modules/suppliers/schema.ts:103` | Chưa có mô hình yêu cầu tạm ứng độc lập như trang minh họa. Ưu tiên gắn đề nghị theo đơn; xác nhận của NCC không tạo phiếu chi |
| Sản phẩm | Danh mục sản phẩm chung: `src/modules/catalog/schema.ts:49`; dòng hàng có liên kết đơn NCC: `src/modules/suppliers/schema.ts:170` | Sản phẩm từ các đơn của NCC hoặc danh mục NCC được công ty duyệt chia sẻ; không mở toàn bộ danh mục nội bộ tự động. Giá chỉ thuộc giao dịch của NCC đó |
| Kiểm tồn | `warehouses.kind=supplier` có sẵn nhưng không có supplierId trên warehouse: `src/modules/catalog/schema.ts:32`; sổ kho `src/modules/inventory/schema.ts:7` | Chưa có ánh xạ nguồn tồn riêng từng NCC được xác minh. Cần model/contract công bố tồn hoặc ánh xạ kho với NCC. Không suy toàn bộ tồn kho loại supplier là tồn của tài khoản đang đăng nhập |
| Điều chuyển | `stock_transfers`: `src/modules/inventory/schema.ts:81`, from/to warehouse và nhân viên; không có supplierId trong model này | Chưa có liên kết quyền NCC trên phiếu. Cần mapping/chứng từ giao nhận liên quan NCC; chưa mở API nội bộ hoặc ghi sổ kho từ portal |
| Phiếu giao/nhận | `delivery_note_id` trên đơn: `src/modules/suppliers/schema.ts:112`; phiếu nhận có `receipt_no` và `shipment_id`: `:314`; số lượng đạt/hỏng: `:351` | Giữ nguyên phân biệt số phiếu hai bên. Cần xác minh ý nghĩa/link gốc deliveryNoteId và mô hình nhiều phiếu giao mỗi đơn trước khi thêm trường số NCC; không đổi tên field để đoán nghĩa |
| Hóa đơn | Chưa thấy trường invoice trong `src/modules/suppliers/schema.ts` sau khi rà soát | Nguồn hóa đơn NCC, quan hệ một/nhiều đơn, đối chiếu VAT và file đính kèm **chưa xác minh**. Cần model mới và hợp đồng trước khi ghi thật |

## Quyền và kiến trúc

- NCC chỉ vào `self` và `supplier-portal`, theo `src/modules/staff/domain/area-policy.ts:31`; không nới area business/ncc-admin. Trang NCC và nhân viên còn có chuyển hướng riêng ở `:49`.
- Manager xem như người nội bộ; không phản hồi thay NCC bằng cổng này. Giữ kiểm tra ở frontend `trial-ui/supplier-portal.js:31` và backend `supplierFor` nêu trên.
- API mới thuộc module `suppliers`; domain vẫn thuần; kết nối module bằng contract trong `src/core/contracts/` và wiring tại app nếu cần. Giữ ALLOWED hiện hành `tests/architecture.test.ts:17`, kiểm tra cấm domain import DB `:58`.
- Response phải theo danh sách trường được phép, không trả thông tin khách mua cuối, lương, lợi nhuận/giá vốn công ty, ghi chú nội bộ, signed URL không giới hạn phạm vi.
- Mọi kiểm tra quyền phải diễn ra ở API/SQL, bao gồm detail, số tổng, export, file download. Ẩn menu không thay thế phân quyền.

## Nguyên tắc dữ liệu và hiệu năng khi nối thật

1. Tạm ứng: đề nghị/duyệt ≠ đã chi. Chỉ chứng từ chi có hiệu lực làm tăng tiền NCC đã nhận. Một khoản chi chỉ tính một lần theo khóa chứng từ.
2. Hóa đơn và phiếu giao là chứng từ đối chiếu; không tự cộng tiền công nợ. Hàng nhận lại/giảm trừ chỉ ảnh hưởng khi đúng điều kiện nghiệp vụ đã xác nhận.
3. Số dư lịch sử phải căn cứ chứng từ có ngày hiệu lực, xử lý hủy/điều chỉnh theo lịch sử. Cột đã thanh toán tổng hợp hiện tại không đủ chứng minh số dư của mọi ngày quá khứ.
4. Prototype dùng ledger và credit giả để duyệt cách trình bày. Công thức này **không thay thế** công thức production hoặc tự khẳng định hệ thống đã có bảng credit.
5. Không có dữ liệu phải hiển thị “chưa công bố/chưa đối chiếu”; không thay bằng 0. Tồn NCC công bố khác tồn nội bộ công ty và khác hàng được phép bán.
6. Server lọc/phân trang trước, aggregate trên cùng bộ lọc, thứ tự ổn định theo ngày/id. Không tải ba năm dữ liệu về trình duyệt; lấy chi tiết khi người dùng mở. Tối đa 50–100 dòng/lần theo endpoint.
7. Debounce tìm kiếm 250–350 ms khi dùng API thật, hủy request cũ hoặc kiểm tra requestId để tránh ghi đè kết quả. Không polling nền mọi trang, không tải toàn bộ tab ngay sau đăng nhập.
8. Ghi có clientKey/idempotency, revision chống ghi đè, kiểm tra trạng thái, khóa đúng dòng khi cần; không retry mù thao tác có kết quả chưa rõ.
9. Index chỉ đề xuất sau EXPLAIN bằng dữ liệu giả đủ lớn; migration mới kèm assert chỉ đọc, phê duyệt trước khi áp dụng production. Không sửa migration cũ, pooler hay Sapo.

## Thứ tự triển khai sau khi được duyệt

| Đợt | Phạm vi | Cổng kiểm tra |
|---|---|---|
| 0 — hiện tại | Form đăng nhập + prototype + hồ sơ/ảnh | Anh duyệt giao diện và ba giả định nghiệp vụ dưới đây; chưa deploy |
| 1 | Shell portal thật + GET tổng quan/đơn/chi tiết theo NCC, schema response allowlist | PGlite: hai NCC không nhìn nhau, supplier inactive, đơn nháp/chưa gửi, sửa supplierId, paging/sort, số tổng cùng filter. Browser desktop/mobile và mốc query trước/sau |
| 2 | Nối phiếu xin hàng hiện có, phản hồi đúng trạng thái/revision | Giao một phần, đơn tách, nhiều NCC chung phiếu, bấm hai lần, mất mạng sau ghi, Manager chỉ xem |
| 3 | Công nợ/phiếu chi/cọc chỉ đọc, danh mục theo đơn | Đối chiếu với nguồn nội bộ cùng kỳ: CK/VAT theo dòng, hủy đơn/phiếu, chi nhiều đợt, hoàn hàng, số dư lịch sử; không cộng trùng |
| 4 | Công bố tồn và giao nhận/điều chuyển đã chốt mapping | Chỉ kho/mã/phiếu được chia sẻ; nhận một phần, trả lại, quantity null/0; NCC không tự tăng/giảm sổ kho |
| 5 | Hóa đơn, số phiếu giao NCC, yêu cầu tạm ứng và file riêng tư | Migration/assert nếu cần; nhiều chứng từ/đơn, chống trùng, kiểm tra file, quyền tải, audit; không tự ghi nhận đã trả tiền |

Mỗi đợt là PR riêng; chạy typecheck, kiểm thử liên quan/kiến trúc, build, browser và đối chiếu dữ liệu trước khi cho deploy. Mở lại giao diện cũ bằng rollback commit UI nếu cần; không xóa chứng từ đã ghi.

## Ba giả định đang dùng để duyệt

1. Kiểm tồn chỉ hiển thị hàng/nguồn tồn thuộc NCC đó. Khuyến nghị công ty duyệt chia sẻ trước khi cho NCC thấy tồn tại kho công ty.
2. Tạm ứng là công ty ứng/cọc cho NCC, gắn đơn cụ thể. Khuyến nghị tách hoàn ứng/chiều ngược nếu phát sinh, không gộp số âm vào khoản đề nghị.
3. Điều chuyển chỉ cho xem và phản hồi phiếu có NCC tham gia. Khuyến nghị không cho NCC tạo phiếu điều chuyển kho nội bộ hoặc tự ghi sổ kho.

## Kiểm thử đã chạy

- Form đăng nhập: 5 kịch bản trình duyệt, 390/1280 px; bật/tắt Turnstile; gửi trùng; sai mật khẩu rồi thử lại; hiện/ẩn mật khẩu; tài khoản nhân viên bị chặn phạm vi NCC.
- Bản workspace: 10 trang × 4 cỡ 360/390/768/1440 px; không tràn ngang; mở/đóng chi tiết, rỗng, filter sai, trạng thái, phân trang, CSV theo filter, ngày đối chiếu, tồn chưa công bố, biểu mẫu vượt tiền, menu điện thoại. Không có external request hoặc business write.
- Mô hình dữ liệu mẫu: 13 ca `supplier-workspace-model.test.mjs`, gồm phạm vi NCC, VAT/tiền dòng, payment/credit trùng, hủy/future/unposted, số dư ngày, null/0, CSV injection.
- Bộ lọc 10.000 dòng mẫu khoảng 83 ms ở một lượt chạy local; **không phải benchmark API/database production**. Số DOM vẫn theo trang 8/16/32.
- 24 test liên quan/kiến trúc đạt; browser với router/PGlite thật đạt cho Manager/NCC ở 390/1280 px, không gọi API nội bộ bằng tài khoản NCC, không ghi dữ liệu khi điều hướng.
- Bản HTML độc lập: 20 lượt mở trang ở 390/1440 px qua localhost; form preview không gửi tài khoản/email; không tải tài nguyên ngoài. Đã kiểm tra 5 test ràng buộc UI sinh tự động.
- `npm run typecheck`, `npm run ui:build`: đạt. Không chạy toàn bộ mọi test của repo; CI sẽ được theo dõi riêng.

Kết quả và ảnh được xuất vào thư mục `supplier-workspace-review` của bộ bàn giao. Khi sửa giao diện tiếp, chạy lại script sinh ảnh để ảnh không lệch với code.
