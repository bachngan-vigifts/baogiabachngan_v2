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

Các sản phẩm/báo giá lưu trong IndexedDB trên từng trình duyệt, không đọc/ghi DB CRM, đơn hàng hoặc tồn kho. Bản sao JSON để lưu/chuyển máy. Xóa dữ liệu trình duyệt sẽ mất dữ liệu nếu chưa sao lưu. Không có sản phẩm hoặc khách hàng thật được nạp mặc định vào source.

## Triển khai

Giao diện nằm trong `trial-ui/catalogue/`; Pages Functions chỉ chạy `/catalogue/api/*` theo `trial-ui/_routes.json`. API chỉ đọc WooCommerce và ảnh ở `locknlockonline.com` / `minhlongonline.com`, chặn host khác, credentials, port lạ, path ngoài ảnh và response quá lớn. Không forward cookie/header đăng nhập CRM đến nhà cung cấp.

Workflow giao diện hiện có đóng gói Functions khi `wrangler pages deploy trial-ui` chạy từ root repository; bổ sung path filter để thay đổi API catalogue cũng kích hoạt workflow này. Không thay DNS hay cấu hình Supabase.

Trước deploy, `node scripts/stamp-catalogue-version.mjs <commit>` gắn phiên bản vào JS/CSS và vendor script dưới catalogue. Không thay stamper CRM gốc. Các route CRM khác không đi qua Functions catalogue.

## Kiểm chứng

Kiểm tra công thức và các ngưỡng ngân sách, chia trang, đầu vào không hợp lệ và URL allowlist trong `tests/app/catalogue.test.ts`. Trình duyệt local đã thử file Excel mẫu 16 mã Chén cơm Minh Long: nhập 16 dòng, cùng một sản phẩm LocknLock thử → xuất PDF/PowerPoint 8 trang, có 17 QR. XML PowerPoint xác nhận tên/giá là text riêng và sửa được. Cần xác nhận deployment Cloudflare thành công trước khi báo URL production hoạt động.

PDF là ảnh render của từng trang, PowerPoint giữ text/giá/khung/ảnh/QR riêng. Dùng Montserrat trên máy mở PowerPoint để giữ font. Nguồn giá web có thể chặn truy cập; UI có nhập thủ công và upload ảnh.

## Thư viện

PptxGenJS 4.0.1 (MIT), pdf-lib (MIT), SheetJS CE 0.18.5 (Apache-2.0), QRCode.js 1.0.0 (MIT), Montserrat (SIL OFL 1.1). Bản phân phối vendored giữ thông tin bản quyền thư viện. Tài sản VIGIFTS theo mẫu khách hàng cung cấp.

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
