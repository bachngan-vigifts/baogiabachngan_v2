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

## Kiểm tra sau khi nhập

1. Số dòng: `sapo_customers`, `products` khớp bản cũ; tổng `product_count` trong `catalog_versions`.
2. Vài sản phẩm bất kỳ: giá từng bảng giá và tồn từng kho khớp màn hình bản cũ.
3. Đăng nhập trang dùng thử → trang **Sản phẩm** hiện danh mục; gõ tên không dấu trong dòng báo giá ra gợi ý; trang **Khách hàng** hiện đủ tổng số.
4. Deploy lại Edge Function `baogia-v2-api` (router có thêm route sản phẩm) và tải lại `trial-ui/`.
