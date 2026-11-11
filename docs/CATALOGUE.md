# Catalogue QR v2

Đường dẫn: **https://crm.minhlongonline.com/catalogue/**.

## Người dùng

1. Chọn **Nhập Excel** tại màn hình tạo báo giá. Có thể chọn nhiều workbook cùng lúc.
2. Đọc sheet `Nhap link` (nếu không có thì sheet đầu tiên). Cột B: link; F: danh mục; M: `Không` thì bỏ dòng đó. Không nhập sheet `208 SP tham khao` kèm sẵn trong workbook cũ.
3. Đọc giá niêm yết và ảnh từ web nếu dòng chưa đầy đủ; bỏ link trùng. Dòng bị lỗi được tải ra CSV để sửa và nhập lại.
4. Chọn sản phẩm, chỉnh thông tin khách hàng/người tư vấn, xuất PDF hoặc PowerPoint theo mẫu **VIGIFTS - BACH NGAN - QR v2**.
5. Bật **Giá theo bộ 10 SP (đơn giá × 10)** rồi chọn các trang cần áp dụng trong danh sách. Chỉ sản phẩm trên trang đã tick được nhân giá chào sau chiết khấu và phụ phí với 10; các trang khác giữ đơn giá. Giá niêm yết trên trang được chọn cũng hiện theo bộ. Phân nhóm ngân sách dùng giá sau cùng; lựa chọn gắn với sản phẩm, không dùng số trang cố định, nên vẫn đúng khi phân trang thay đổi. Trang giá bộ và trang đơn giá được tách riêng. Bỏ tick chính quay về đơn giá mà không sửa dữ liệu nguồn.

Mặc định: LocknLock = niêm yết × 60% + 15.000đ; Minh Long = niêm yết × 90% + 15.000đ. Có thể sửa từng sản phẩm hoặc tự nhập giá chào.

Mỗi trang chỉ chứa một ngân sách, một thương hiệu, một danh mục; tối đa 4 sản phẩm, 2 hàng × 2 cột. Thư viện mới trống hoàn toàn.

## Lưu trữ

Sản phẩm nguồn được lưu lên thư viện chung của CRM khi nhân viên đăng nhập. Mọi nhân viên được xem, thêm và sửa; dữ liệu chưa gửi được giữ trong hàng chờ IndexedDB theo tài khoản. Báo giá đang sửa vẫn tự lưu trên máy; bấm “Lưu báo giá chung” để lưu lên máy chủ cho toàn bộ nhân viên. Mở rồi lưu cập nhật cùng một mã dữ liệu, không tạo bản mới. “Báo giá mới” tạo mã mới. Báo giá cũ trong trình duyệt có nút “Đưa lên máy chủ”; cần thực hiện từ máy đang giữ dữ liệu cũ. Bản sao JSON vẫn dùng để dự phòng. Không sửa đơn hàng hoặc ghi tồn kho.

## Triển khai

Giao diện nằm trong `trial-ui/catalogue/`; Pages Functions chỉ chạy `/catalogue/api/*` theo `trial-ui/_routes.json`. Các endpoint nguồn chỉ đọc WooCommerce và ảnh ở `locknlockonline.com` / `minhlongonline.com`, chặn host khác, credentials, port lạ, path ngoài ảnh và response quá lớn. Không forward cookie/header đăng nhập CRM đến nhà cung cấp.

Workflow giao diện hiện có đóng gói Functions khi `wrangler pages deploy trial-ui` chạy từ root repository; bổ sung path filter để thay đổi API catalogue cũng kích hoạt workflow này. Không thay DNS. Phần dùng chung cần migration và API CRM trước khi phát hành giao diện.

Trước deploy, `node scripts/stamp-catalogue-version.mjs <commit>` gắn phiên bản vào JS/CSS và vendor script dưới catalogue. Không thay stamper CRM gốc. Các route CRM khác không đi qua Functions catalogue.

## Kiểm chứng

Kiểm tra công thức và các ngưỡng ngân sách, chia trang, đầu vào không hợp lệ và URL allowlist trong `tests/app/catalogue.test.ts`. Trình duyệt local đã thử file Excel mẫu 16 mã Chén cơm Minh Long: nhập 16 dòng, cùng một sản phẩm LocknLock thử → xuất PDF/PowerPoint 8 trang, có 17 QR. XML PowerPoint xác nhận tên/giá là text riêng và sửa được. Cần xác nhận deployment Cloudflare thành công trước khi báo URL production hoạt động.

PDF là ảnh render của từng trang, PowerPoint giữ text/giá/khung/ảnh/QR riêng. Dùng Montserrat trên máy mở PowerPoint để giữ font. Nguồn giá web có thể chặn truy cập; UI có nhập thủ công và upload ảnh.

## Thư viện

PptxGenJS 4.0.1 (MIT), pdf-lib (MIT), SheetJS CE 0.20.3 (Apache-2.0), QRCode.js 1.0.0 (MIT), Montserrat (SIL OFL 1.1). Bản phân phối vendored giữ thông tin bản quyền thư viện. Tài sản VIGIFTS theo mẫu khách hàng cung cấp.

## Product assistant
Staff can describe category and final quotation budget in Vietnamese, review editable criteria, then search live WooCommerce Store APIs for in-stock products. Final price is regular price ×60% (LocknLock) or ×90% (Minh Long), plus VND15,000, before applying the optional 10-unit pack. Results refresh matching library URLs and either replace the selection or append; no product seeds ship.
Cloudflare Workers AI interprets criteria only, after validating the existing CRM bearer session against the fixed staff /me endpoint. Prices, URLs and availability always come from the allowlisted websites. Without a binding/login or on model error, the interface explicitly labels the deterministic command filter. Download existing Pages config before adding the AI binding, preserving unrelated project settings. Local preview does not invoke a billed model.

## Import throughput and page text
Excel rows needing website data run in a six-request pool. Results retain workbook order; canonical product links are deduplicated before requests, including repeated rows in the same workbook. Rows already carrying required fields avoid unnecessary requests. Progress reports completed rows; individual failures still export to CSV.
Each preview page has “Sửa chữ trang này”. Display overrides are saved per page identity and text position, restored with drafts/backups, and shared by canvas, PDF and editable PowerPoint rendering. Product-page identity follows its product IDs rather than numeric position. Price text overrides do not change product calculations; change the product price to change budget grouping or totals. Long text is clipped to the template's available line count.

Import optimization: rows requiring website lookup are now grouped by supplier in batches of up to 20 slugs, with three batches in flight. Only the fields used in quotations are requested. A real 100-URL benchmark returned all 100 products with zero errors in 6.623 seconds across six supplier requests. Browser Excel import also confirmed 100 products added. Timing varies with supplier availability. Duplicate links are skipped before batch construction; errors remain tied to individual Excel rows.

## Multiple assistant groups
The assistant now extracts and edits up to 12 category/budget groups instead of one. Each group has independent brand, live website category or common preset, min/max final price, result limit, keywords and unit/ten-pack pricing. “Thêm danh mục” adds another category; “Thêm mức giá” copies a category into the next budget interval. All groups merge into one quotation, deduplicating supplier URLs and reporting empty groups separately.
The category picker loads published taxonomy with products from both suppliers (122 categories observed). “Ly sứ” and “Ly dưỡng sinh” have separate presets and product-name filters, even though Minh Long assigns both to the same website category. Natural-language parsing preserves explicit categories and price intervals if a small model collapses them. Live stock, price calculation and original quotation grouping remain deterministic.
Pages AI bindings are explicitly configured at root, production and preview because downloaded environment overrides can omit a root-only binding. Existing unrelated settings are retained.

The vendored Excel parser is pinned to SheetJS CE 0.20.3 from its authoritative CDN. All nine original input workbooks and the 100-code fixture were verified with this version.

## CRM stock and direct editing
The assistant now has an explicit stock-source picker. Requests mentioning CRM select the CRM source automatically. Website prices and the agreed discount/fee formula remain the pricing source; eligible stock is verified through the existing authenticated staff products API. `filteredStock` is the CRM authority (real stock warehouses minus active quote holds), never supplier/incoming quantities. Website-out-of-stock products can qualify when CRM stock is positive. Missing/failed CRM reads never fall back to website availability, and SKU comparisons preserve leading zeros. Staff see per-product availability and the check timestamp; stock quantities are not added to customer-facing PDF/PPTX pages.
Text regions in the preview are directly clickable. A positioned textarea edits the same per-page text overrides used by the existing modal, canvas, PDF and PowerPoint. Blur/Ctrl+Enter save and Escape cancels. Editing display text does not alter product pricing calculations.
Validation: 17 isolated tests pass, including authenticated read scope, authoritative available stock, source failure, exact-SKU matching and CRM evidence restore. Browser checked direct title editing, Escape cancel and CRM-source detection with the 1–2 million range applied to both tea sets and vases.

## Sắp xếp sản phẩm và chọn trang xuất

- Kéo tay nắm ở đầu dòng để đổi vị trí bằng chuột hoặc cảm ứng. Danh sách tự cuộn khi kéo gần mép; Esc/huỷ thao tác không thay đổi dữ liệu. Tay nắm hỗ trợ phím lên/xuống, Home/End.
- Chọn sắp xếp: sản phẩm mới (ngày tạo web/CRM, không phải ngày thêm vào báo giá), giá chào tăng dần, bộ sưu tập, danh mục, hoa văn hoặc màu sắc. Kéo tay hoặc nút đưa lên chuyển sang “Tự sắp xếp” và tắt sắp giá tự động. Thứ tự được lưu cùng báo giá/bản sao.
- “Đọc thuộc tính nguồn” bổ sung các trường còn thiếu từ thuộc tính website và dữ liệu CRM được cấp quyền. Không đổi tên, giá, số lượng hoặc tồn. CRM cần phiên đăng nhập và quyền đọc sản phẩm; không đọc được thì giữ dữ liệu cũ và báo rõ. Có thể bổ sung thuộc tính trong Sửa sản phẩm. Không suy đoán bộ sưu tập/màu/hoa văn từ tên, không dùng ngày cập nhật tồn làm ngày tạo. Dữ liệu thiếu được xếp sau.
- Bản xem trước và file xuất giữ quy tắc nhóm ngân sách → thương hiệu → danh mục → giá bộ/đơn; thứ tự mới áp dụng bên trong nhóm. Sản phẩm lẻ một mình trong nhóm vẫn theo quy tắc bỏ qua hiện có.
- Bấm PDF hoặc PowerPoint để chọn tất cả, trang đang xem, hoặc số/khoảng trang như `1, 3-5`. Số trang tính theo toàn bộ bản xem trước, gồm bìa/chia ngân sách/cảm ơn. Bỏ trang trùng, xuất theo thứ tự gốc và giữ số trang như xem trước. Chỉ tải ảnh phục vụ các trang được chọn.

Kiểm tra giao diện bằng `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/testing/catalogue-editor.mjs` (Chromium; có thể đặt CHROMIUM_PATH và BROWSER_EVIDENCE_DIR). Script dùng IndexedDB/dữ liệu giả và chặn mọi kết nối ngoài localhost; kiểm tra kéo chuột/cảm ứng, tự cuộn, huỷ kéo, bàn phím, sắp xếp/lưu lại và xuất PDF/PPTX thật. Không cần migration.

## Thư viện và báo giá dùng chung (2026-11-03)

- Thư viện nguồn: tìm không dấu theo tên/SKU và lọc thương hiệu, danh mục, bộ sưu tập, hoa văn, màu sắc. Phân trang 60 mã, nạp tồn theo lô. Link nguồn + SKU/brand xác định bản ghi chung; nhập lại giữ bản đã có, sửa chung dùng revision để tránh mất thay đổi.
- Chỉ lưu thông tin nguồn vào thư viện; số lượng, chiết khấu, phụ phí, giá tự nhập và khách hàng thuộc từng báo giá. Sửa nguồn không tự đổi giá báo giá đã chọn/lưu. Dữ liệu còn thiếu thuộc tính hiển thị rõ, không đoán từ tên.
- Tồn khả dụng dùng sổ kho CRM và giữ hàng hiện có, loại kho ẩn theo người xem. Tổng khả dụng trừ giữ hàng theo quy tắc catalogue hiện hành; từng kho là đánh giá độc lập, không cộng các số khả dụng từng kho khi có giữ hàng chung. Hàng đang về lấy số còn phải nhận từ đơn mua đã duyệt; tồn NCC hiển thị riêng. Mã không khớp, thiếu bằng chứng hoặc đọc lỗi là “Chưa rõ”, không coi là hết hàng. Có thời điểm kiểm tra; số liệu chỉ phục vụ nội bộ, không đưa vào PDF/PPTX/báo giá dùng chung.
- `/catalogue-quotes` trả danh sách tóm tắt 30 bản/lượt; mở chi tiết mới tải snapshot. Tất cả nhân viên được mở/sửa. Người tạo hoặc Manager được ẩn báo giá (soft delete).
- Lưu báo giá dùng ID ổn định, revision/CAS và nhật ký clientKey+hash trong cùng transaction. Bấm lại sau mất phản hồi trả biên nhận cũ; nếu có bản sửa mới hơn phải đối chiếu. Hai nhân viên lưu cùng revision chỉ một lần thành công. Không có thêm thẻ hay phiên bản báo giá hiển thị khi sửa; nhật ký chỉ giữ biên nhận và audit.
- Yêu cầu chưa xác nhận giữ trên máy theo người gửi; không gửi lại bằng phiên nhân viên khác. Bản nhập đang sửa không bị thay bằng phản hồi chậm. Nếu xung đột, tải bản sao trước khi mở lại bản chung để đối chiếu.

### Thứ tự phát hành

1. Chủ dự án chạy tay **migrations/postgres/20261103042748_catalogue_shared_library.sql** đúng một lần (3 bảng mới, RLS, chỉ backend được truy cập). Không chạy lại nếu đã có các bảng.
2. Triển khai API; bước read-only `scripts/sql/assert-catalogue-library.sql` kiểm tra đủ bảng/cột, RLS, khoá chống trùng.
3. Triển khai giao diện. Chưa có migration/API thì báo chưa lưu dùng chung, giữ dữ liệu trên máy. Không tuyên bố đã lưu máy chủ khi chưa có xác nhận.

Kiểm thử: `tests/app/catalogue-library.test.ts`, `catalogue-quotes.test.ts`, `catalogue-library-proxy.test.ts`, `tests/db/catalogue-library-access.test.ts`; thêm `TEST_PG_URL` trỏ PostgreSQL thử để chạy các ca đồng thời. `scripts/testing/catalogue-shared-library.mjs` dùng hai tài khoản giả trên localhost, chặn mạng ngoài: cùng thấy/sửa nguồn, giữ giá báo giá, mất phản hồi, đổi tài khoản, báo giá cập nhật cùng ID, CAS và mobile.

## Tick nhiều sản phẩm

- Checkbox và nút ảnh tick sản phẩm để thao tác, tách biệt với trạng thái đã có trong báo giá. Có “Chọn cả trang”, bỏ tick và giới hạn 100 mã/lượt; lựa chọn giữ khi đổi trang/bộ lọc và xoá khi đổi tài khoản.
- Thêm hàng loạt chỉ thêm mã còn thiếu, giữ số lượng/giá/chiết khấu của mã đã có trong báo giá và chỉ dựng lại giao diện một lần.
- Sửa chung chỉ áp dụng trường được tick: danh mục, bộ sưu tập, hoa văn, màu sắc, giá niêm yết. Thuộc tính rỗng có thể xoá khi tick rõ; danh mục phải có giá trị. SKU/brand/link nguồn giữ nguyên định danh. Các bản sao trong báo giá không đổi.
- Xoá cần xác nhận số lượng/phạm vi dùng chung, lưu `deleted_at/deleted_by` thay vì xoá vật lý. Bật “Đã xoá” để chọn và khôi phục. Nhập lại nguồn đã xoá báo cần khôi phục, không tạo bản ghi khác hoặc tự hồi sinh.
- API khoá cả nhóm theo thứ tự ID và kiểm tra mọi revision trước khi ghi; một mã xung đột thì cả nhóm không đổi. Biên nhận clientKey+hash lưu cùng transaction, retry sau mất phản hồi không ghi thêm. Hàng chờ trên máy theo tài khoản; nút đối soát gửi lại đúng yêu cầu cũ, không lấy phiên người khác. Bản báo giá đang sửa và hàng chờ được lưu cùng transaction IndexedDB trước khi gửi.

Migration mới: **20261103070624_catalogue_library_bulk.sql**, chạy tay đúng một lần sau migration thư viện 20261103042748, trước API và giao diện. Chỉ thêm cột xoá mềm và bảng biên nhận bulk có RLS; không xoá sản phẩm/báo giá có sẵn. Chưa chạy production trong quá trình làm tính năng này.

## Catalogue trong Trang chủ và hồ sơ khách hàng

- Nút **Tạo báo giá / Catalogue** nằm ở góc phải đầu Trang chủ, mở tab mới; bỏ shortcut Catalogue khỏi Sơ đồ quy trình.
- Khi lưu từ giao diện mới, chọn khách đã duyệt trong danh bạ (tìm từ 2 ký tự). Lưu `meta.customerId` trong snapshot hiện có; máy chủ kiểm tra quyền Manager/phụ trách/chia sẻ hoặc quyền xem toàn bộ của Sale Admin và lấy tên chính thức. Không tự gắn bằng tên, kể cả hai khách trùng tên.
- Báo giá đã gắn khách không thể bị client cũ xoá liên kết; khi chuyển sang khách khác, kiểm tra quyền cả khách cũ và mới. Bản cũ chưa có ID tiếp tục được đọc, không backfill theo tên; chọn đúng khách trước khi lưu lại từ giao diện mới.
- Hồ sơ khách có tab **Báo giá Catalogue**, hiển thị tối đa 100 bản gần nhất chưa ẩn, chỉ tóm tắt; bấm mới tải snapshot. Người xem toàn bộ hồ sơ thấy mọi báo giá gắn khách; người khác chỉ thấy bản do mình tạo. Quyền mở thư viện Catalogue dùng chung vẫn theo chính sách hiện có, không biến thành kho tài liệu riêng theo khách.
- Nút **＋ Báo giá Catalogue** trong hồ sơ mở khách được chọn sẵn. Nếu đang có sản phẩm đã chọn, hỏi xác nhận tạo mới và giữ bản khôi phục trên máy; vẫn giữ thư viện sản phẩm. Tham số mở được tiêu thụ để tải lại không ghi đè phần đang sửa.
- Lưu và gộp khách dùng chung khoá định danh để tránh liên kết mồ côi khi chạy đồng thời. Gộp khách cập nhật ID/tên của các bản Catalogue trong cùng transaction và tăng revision để client cũ không ghi đè. Báo giá Catalogue không phải báo giá CRM được duyệt, không tự cộng doanh số, công nợ hoặc tạo đơn.
- Không thêm bảng/cột/migration. API phải triển khai trước giao diện; giữ cổng chờ API trong workflow UI.
- Kiểm tra luồng: `node --import tsx scripts/testing/catalogue-customer-links.mjs` chạy Chromium với API và CSDL thử cô lập, chặn mạng ngoài, ở 1440px và 390px. Kiểm tra quyền/API: `tests/app/catalogue-customer-links.test.ts`; proxy: `tests/app/catalogue-library-proxy.test.ts`.
