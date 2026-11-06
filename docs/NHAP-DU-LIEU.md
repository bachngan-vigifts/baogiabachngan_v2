# Nhập khách hàng và sản phẩm từ web cũ vào Supabase

Chủ dự án chốt: **Codex nhập dữ liệu** (Codex truy cập được D1/R2 của web cũ trên ChatGPT Sites). Giao diện và API đọc dữ liệu đã có sẵn; tài liệu này nói dữ liệu cần nằm ở bảng nào để giao diện hiện đúng.

Nguyên tắc: chạy trên **bản sao/branch** trước, idempotent (`INSERT … ON CONFLICT DO UPDATE`), không xoá dữ liệu người dùng đã tạo trên v2. Không đưa dữ liệu thật vào repo.

## Khách hàng → `sapo_customers`

Nguồn: bảng `sapo_customers` (D1 bản cũ). Giữ nguyên `id` cũ (báo giá cũ tham chiếu `customerId`).

| Cột v2 | Lấy từ bản cũ | Ghi chú |
| --- | --- | --- |
| `id`, `name`, `contact`, `phone`, `email`, `address`, `tax_code`, `customer_code`, `created_at`, `source_version`, `synced_at` | cùng tên | `contact/phone/email/address` NOT NULL → dùng `''` khi trống |
| `search` | tính lại | không bắt buộc (API tự tìm không dấu trên các cột trên), nên đặt = chữ thường bỏ dấu của `name contact phone email tax_code customer_code` cho đồng nhất với khách tạo trên v2 |
| `customer_brand_discounts` | cột JSON `discounts` `{lys, minhLong, lock}` | mỗi khoá có số → 1 dòng (`customer_id`, `brand_key`, `percent` 0–100) |

API: `GET /api/staff/customers?q=&limit=&offset=` (tối đa 500/lần, có `total`) – chịu được hàng nghìn khách.

## Sản phẩm → các bảng catalog

Nguồn: `catalogs/current.json` trên R2 (định dạng `sapo-catalog-v1`: `warehouses[]`, `pricePolicies[]`, `products[]` với `prices[]`/`stock[]` theo đúng thứ tự hai mảng trên), rồi **phủ** `product_edits` (D1) và file tồn kho mới nhất như `catalogData()` của bản cũ (`lib/product-catalog.mjs`).

| Bảng v2 | Dữ liệu |
| --- | --- |
| `price_policies` (`id`, `name`, `sort_order`) | mỗi phần tử `pricePolicies[i]`; `sort_order = i`. **Bảng giá đầu tiên là giá mặc định** khi thêm sản phẩm vào báo giá (người dùng đổi được trên trang Sản phẩm) |
| `warehouses` (`id`, `name`, `kind`, `sort_order`, `active`) | mỗi `warehouses[i]`; `kind`: `'NCC'` → `supplier`, `'Hàng chờ về'` → `incoming`, còn lại `stock`. "Tồn kho" trên giao diện = tổng các kho `stock` |
| `products` | `sku, name, brand, pattern, unit, image_url (= image), tax_basis, tax_in, tax_out, taxable, per_carton, carton_weight, carton_length, carton_width, carton_height, active = true, updated_at` |
| `product_prices` (`sku`, `policy_id`, `price`) | `prices[i]` → `policy_id` của `pricePolicies[i]`; giữ `null` = chưa có giá |
| `product_stock` (`sku`, `warehouse_id`, `quantity`, `updated_at`) | `stock[i]` khác `null` → 1 dòng (cho phép âm) |
| `catalog_versions` | 1 dòng `is_current = true`, `observed_at` = `observedAt` của catalog, `product_count` |

Sản phẩm ngừng bán: đặt `active = false` (không xoá, báo giá cũ vẫn giữ dữ liệu trong `data`).

API: `GET /api/staff/products?q=&brand=&limit=&offset=` (tìm không dấu theo SKU/tên/thương hiệu), `GET /api/staff/product-brands`, `GET /api/staff/products/:sku`.

**Cách nhập khuyên dùng:** Manager bấm **Nhập danh mục** trên trang Sản phẩm và chọn file JSON lấy từ web cũ (`GET /api/staff/catalog`). Giao diện gọi `POST /api/staff/admin/catalog-import` theo lô 500 mã:
- lô thường: ghi đè tên/giá/tồn của các mã trong lô (không tạo dòng trùng; bảng giá/kho trùng tên được dùng lại);
- lô cuối: thêm `replaceAll: true` và `allSkus` (mọi mã trong file) → ẩn sản phẩm không còn trong file, ngừng dùng kho không còn, ghi `catalog_versions`.
Lời gọi không có `replaceAll` không bao giờ ẩn sản phẩm. Lỗi giữa chừng: chọn lại file, chạy lại từ đầu (idempotent).

## Kiểm tra sau khi nhập

1. Số dòng: `sapo_customers`, `products` khớp bản cũ; tổng `product_count` trong `catalog_versions`.
2. Vài sản phẩm bất kỳ: giá từng bảng giá và tồn từng kho khớp màn hình bản cũ.
3. Đăng nhập trang dùng thử → trang **Sản phẩm** hiện danh mục; gõ tên không dấu trong dòng báo giá ra gợi ý; trang **Khách hàng** hiện đủ tổng số.
4. Deploy lại Edge Function `baogia-v2-api` (router có thêm route sản phẩm) và tải lại `trial-ui/`.

## Phân tỉnh và chia sẻ khách hàng hàng loạt

CRM nhận diện tỉnh/thành từ địa chỉ và quy đổi tên cũ sang 34 đơn vị cấp tỉnh theo [Nghị quyết 202/2025/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/202qh.signed.pdf). Ví dụ: Kiên Giang → An Giang; Hậu Giang/Sóc Trăng → Cần Thơ. Địa chỉ gốc được giữ nguyên; thông tin tỉnh được tính khi đọc nên dữ liệu mới đồng bộ từ Sapo cũng được nhận diện. Không cần migration hay ghi lại toàn bộ địa chỉ.

Trong **Khách hàng**, dùng bộ lọc **Tỉnh/thành sau sáp nhập**. Hồ sơ chi tiết và danh sách cùng hiển thị tỉnh đã nhận diện. Địa chỉ thiếu, tên đường/phường trùng tên tỉnh hoặc có nhiều tỉnh khác nhau được để **Chưa xác định**; kiểm tra và bổ sung địa chỉ đầy đủ trong hồ sơ trước khi phân nhóm.

Manager bấm **Chia sẻ theo tỉnh** → chọn tỉnh và 1–10 nhân viên → **Xem trước** → **Chia sẻ khách hàng**. Phạm vi là tất cả khách đã duyệt của tỉnh, gồm doanh nghiệp và khách lẻ, tối đa 5.000 khách mỗi lượt; các bộ lọc tìm kiếm khác không áp dụng trong hộp thoại này. Bảng xem trước nêu rõ số khách, nhân viên nhận và số lượt chia sẻ mới. Thao tác chỉ thêm chia sẻ, giữ người phụ trách và chia sẻ hiện có, không tạo trùng khi gửi lại. Nếu địa chỉ/danh sách khách thay đổi sau xem trước, phải xem trước lại. Nếu một khách vượt giới hạn 30 người được chia sẻ, cả lượt bị chặn, không áp dụng một phần.
