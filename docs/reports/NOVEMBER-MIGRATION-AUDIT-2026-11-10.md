# Kiểm tra migration production tháng 11 — 10/11/2026

Nguồn: `main` ban đầu `72cc171fd446313bcb12829886ca3d8518c87651`; cập nhật trong phiên đến `a08adebcddf2b42108971aa15152879fbe7b64d2`. Tất cả truy vấn kiểm tra production dùng `BEGIN TRANSACTION READ ONLY`. Không chạy migration, không kích hoạt workflow deploy trong đợt kiểm tra này.

## Kết luận tại thời điểm kiểm tra

- Thư mục đúng là `migrations/postgres/`, không phải `supabase/migrations/`.
- 36 migration tháng 11 trên main ban đầu đều vượt các kiểm tra hiện có/bổ sung. Có 7 file chưa có gate riêng; 5 file trong danh sách nghi thiếu thực ra đã có gate, nhưng cần kiểm tra thêm ràng buộc/index.
- SePay proximity đã có từ lần xử lý trước. Kiểm tra lại trả `sepay_proximity_schema_ok`; không cần chạy lại hoặc dựng lại index.
- Trong phiên main thêm migration thứ 37, `20261110020309_sepay_page_permission.sql` từ PR #605. Lần đọc đầu chưa thấy marker; workflow tự động từ các merge mới đang chạy. Đây là phát sinh mới, cần kiểm tra lại trước kết luận deploy.
- Bằng chứng là trạng thái đối tượng/seed hiện tại, không phải khẳng định lịch sử chạy file. Đặc biệt quyền có thể do Manager thay đổi sau migration.

## Các migration cần bổ sung hoặc tăng độ chặt của gate

Chạy nguyên nội dung SQL được liên kết trong transaction READ ONLY. Mỗi assert gom các phép SELECT catalog và phát sinh lỗi khi bất kỳ phép kiểm tra nào sai; kết quả `*_ready` chứng minh mọi phép kiểm tra trong file đều đạt.

| Migration | Gate trước PR | Đã áp dụng theo đối tượng hiện có | Query và kết quả production |
|---|---|---|---|
| `20261103094412_crm_catalog_autovacuum.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-crm-catalog-autovacuum.sql): 15/15 kiểm tra PASS |
| `20261103095218_product_search_trigram.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-product-search-trigram.sql): 3/3 kiểm tra PASS |
| `20261104000000_internal_reports.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-internal-reports.sql): 2/2 kiểm tra PASS |
| `20261105042029_payroll_attendance_counters.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-payroll-attendance-counters.sql): 3/3 kiểm tra PASS |
| `20261107074837_order_products_page_permission.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-order-products-page-permission.sql): 1/1 kiểm tra PASS |
| `20261111090000_purchase_permissions.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-purchase-permissions.sql): 2/2 kiểm tra PASS |
| `20261115091000_historical_cost_sources.sql` | Chưa có | Có | [SQL](../../scripts/sql/assert-historical-cost-sources.sql): 2/2 kiểm tra PASS |
| `20261105010141_customer_established_date.sql` | Có, còn thiếu kiểm tra chi tiết | Có | [SQL](../../scripts/sql/assert-customer-established-date-complete.sql): 2/2 kiểm tra PASS |
| `20261106011701_hr_revenue_targets.sql` | Có, còn thiếu kiểm tra chi tiết | Có | [SQL](../../scripts/sql/assert-hr-revenue-targets-complete.sql): 14/14 kiểm tra PASS |
| `20261106032801_hr_revenue_target_requests.sql` | Có, còn thiếu kiểm tra chi tiết | Có | [SQL](../../scripts/sql/assert-hr-revenue-target-requests-complete.sql): 28/28 kiểm tra PASS |
| `20261106035214_sales_payroll_team_sources.sql` | Có, còn thiếu kiểm tra chi tiết | Có | [SQL](../../scripts/sql/assert-sales-payroll-team-sources-complete.sql): 19/19 kiểm tra PASS |
| `20261111100000_customer_profile_fields.sql` | Có, còn thiếu kiểm tra chi tiết | Có | [SQL](../../scripts/sql/assert-customer-profile-fields-complete.sql): 25/25 kiểm tra PASS |

### Bằng chứng quan trọng

`purchase_permissions`: kiểm tra hai nhóm seed bằng `NOT EXISTS`: quyền `purchases.early-view` cho mọi chức vụ có `page.purchases`; 5 cặp quyền/chức vụ mặc định trong migration có chức vụ còn tồn tại. Production hiện có đủ **11/11** cặp: accounting (confirm, early-view, receive), sale (early-view), sale-admin (cancel-approved, confirm, early-request, early-view), sales-lock/sales-ml/warehouse (early-view). Không ghi hoặc cấp lại quyền.

`order_products_page_permission`: mọi chức vụ có `page.orders`, trừ manager/supplier/customer, hiện có `page.order-products`; **6/6** accounting, it, sale, sale-admin, sales-lock, sales-ml.

`customer_profile_fields`: 5 cột đúng kiểu và nullable; 2 FK khách hàng đúng đích, representative có ON DELETE SET NULL; 3 CHECK đã validate; index representative đúng cột, partial, valid/ready. `customer_debt_notes`: 5 cột, PK, 2 FK (customer ON DELETE CASCADE), 2 CHECK, RLS, không cấp PUBLIC/anon/authenticated, service_role đủ quyền. **25/25 kiểm tra PASS**. Ngày thành lập date và CHECK giới hạn năm cũng PASS trong gate riêng.

Autovacuum: 3 bảng × 4 tùy chọn đúng: vacuum scale 0.05, vacuum threshold 50, analyze scale 0.02, analyze threshold 50. Trigram: extension pg_trgm và cả hai GIN index valid/ready, đúng bảng/các trường và dạng biểu thức tìm kiếm.

Không migration nào trong nhóm 36 ban đầu tạo function, trigger hay policy riêng; dùng catalog function/trigger/policy để suy đoán một đối tượng không có trong migration sẽ không có ý nghĩa. Các bảng riêng tư được kiểm tra RLS và ACL. Không đọc dữ liệu khách hàng hay thanh toán trong kiểm tra này.

## Toàn bộ phạm vi tháng 11

Các file dùng chung assert được ghi rõ, ví dụ transfer_receive/outbox và hai migration catalogue. Các gate cũ có phạm vi kiểm tra khác nhau; PASS không đồng nghĩa mọi chi tiết schema của mọi bảng đều đã được so sánh tuyệt đối.

| Migration | Assert được nối deploy | Kết quả đọc |
|---|---|---|
| `20261102071719_customer_cash_collections.sql` | [assert-customer-cash-collections.sql](../../scripts/sql/assert-customer-cash-collections.sql) | PASS |
| `20261102104511_transfer_received_outbox.sql` | [assert-transfer-outbox.sql](../../scripts/sql/assert-transfer-outbox.sql) | PASS |
| `20261102120000_transfer_receive.sql` | [assert-transfer-outbox.sql](../../scripts/sql/assert-transfer-outbox.sql) | PASS |
| `20261102123212_web_order_crm_edit.sql` | [assert-web-order-crm-edit.sql](../../scripts/sql/assert-web-order-crm-edit.sql) | PASS |
| `20261103042748_catalogue_shared_library.sql` | [assert-catalogue-library.sql](../../scripts/sql/assert-catalogue-library.sql) | PASS |
| `20261103070624_catalogue_library_bulk.sql` | [assert-catalogue-library.sql](../../scripts/sql/assert-catalogue-library.sql) | PASS |
| `20261103094412_crm_catalog_autovacuum.sql` | [assert-crm-catalog-autovacuum.sql](../../scripts/sql/assert-crm-catalog-autovacuum.sql) | PASS |
| `20261103095218_product_search_trigram.sql` | [assert-product-search-trigram.sql](../../scripts/sql/assert-product-search-trigram.sql) | PASS |
| `20261104000000_internal_reports.sql` | [assert-internal-reports.sql](../../scripts/sql/assert-internal-reports.sql) | PASS |
| `20261105010141_customer_established_date.sql` | [assert-customer-established-date.sql](../../scripts/sql/assert-customer-established-date.sql)<br>[assert-customer-established-date-complete.sql](../../scripts/sql/assert-customer-established-date-complete.sql) | PASS |
| `20261105025522_appsheet_customer_sync.sql` | [assert-appsheet-customers.sql](../../scripts/sql/assert-appsheet-customers.sql) | PASS |
| `20261105030000_hr_member_kpi_targets.sql` | [assert-hr-member-kpi-targets.sql](../../scripts/sql/assert-hr-member-kpi-targets.sql) | PASS |
| `20261105042029_payroll_attendance_counters.sql` | [assert-payroll-attendance-counters.sql](../../scripts/sql/assert-payroll-attendance-counters.sql) | PASS |
| `20261105060000_software_feedback.sql` | [assert-software-feedback.sql](../../scripts/sql/assert-software-feedback.sql) | PASS |
| `20261106011701_hr_revenue_targets.sql` | [assert-hr-revenue-targets.sql](../../scripts/sql/assert-hr-revenue-targets.sql)<br>[assert-hr-revenue-targets-complete.sql](../../scripts/sql/assert-hr-revenue-targets-complete.sql) | PASS |
| `20261106032801_hr_revenue_target_requests.sql` | [assert-hr-revenue-target-requests.sql](../../scripts/sql/assert-hr-revenue-target-requests.sql)<br>[assert-hr-revenue-target-requests-complete.sql](../../scripts/sql/assert-hr-revenue-target-requests-complete.sql) | PASS |
| `20261106035214_sales_payroll_team_sources.sql` | [assert-sales-payroll-team-sources.sql](../../scripts/sql/assert-sales-payroll-team-sources.sql)<br>[assert-sales-payroll-team-sources-complete.sql](../../scripts/sql/assert-sales-payroll-team-sources-complete.sql) | PASS |
| `20261107064327_customer_center_campaigns.sql` | [assert-customer-center-campaigns.sql](../../scripts/sql/assert-customer-center-campaigns.sql) | PASS |
| `20261107074837_order_products_page_permission.sql` | [assert-order-products-page-permission.sql](../../scripts/sql/assert-order-products-page-permission.sql) | PASS |
| `20261107161337_product_custody.sql` | [assert-product-custody.sql](../../scripts/sql/assert-product-custody.sql) | PASS |
| `20261108223847_warehouse_workspace.sql` | [assert-warehouse-workspace.sql](../../scripts/sql/assert-warehouse-workspace.sql) | PASS |
| `20261109050000_sepay_transactions.sql` | [assert-sepay-transactions.sql](../../scripts/sql/assert-sepay-transactions.sql) | PASS |
| `20261109123446_sepay_lock_web_match.sql` | [assert-sepay-web.sql](../../scripts/sql/assert-sepay-web.sql) | PASS |
| `20261109193137_sepay_proximity_indexes.sql` | [assert-sepay-proximity.sql](../../scripts/sql/assert-sepay-proximity.sql) | PASS |
| `20261110020309_sepay_page_permission.sql` | [assert-sepay-page-permission.sql](../../scripts/sql/assert-sepay-page-permission.sql) | Chưa thấy marker khi kiểm tra lần đầu; chờ workflow tự động |
| `20261111090000_purchase_permissions.sql` | [assert-purchase-permissions.sql](../../scripts/sql/assert-purchase-permissions.sql) | PASS |
| `20261111100000_customer_profile_fields.sql` | [assert-customer-profile-fields.sql](../../scripts/sql/assert-customer-profile-fields.sql)<br>[assert-customer-profile-fields-complete.sql](../../scripts/sql/assert-customer-profile-fields-complete.sql) | PASS |
| `20261111100000_store_manager_reports.sql` | [assert-store-manager-reports.sql](../../scripts/sql/assert-store-manager-reports.sql) | PASS |
| `20261112090000_store_report_submission.sql` | [assert-store-report-submission.sql](../../scripts/sql/assert-store-report-submission.sql) | PASS |
| `20261112100000_store_report_files.sql` | [assert-store-report-files.sql](../../scripts/sql/assert-store-report-files.sql) | PASS |
| `20261112110000_store_restock_rules.sql` | [assert-store-restock-rules.sql](../../scripts/sql/assert-store-restock-rules.sql) | PASS |
| `20261113090000_staff_weekly_reports.sql` | [assert-staff-weekly-reports.sql](../../scripts/sql/assert-staff-weekly-reports.sql) | PASS |
| `20261114090000_staff_monthly_reports.sql` | [assert-staff-monthly-reports.sql](../../scripts/sql/assert-staff-monthly-reports.sql) | PASS |
| `20261115090000_sales_line_costs.sql` | [assert-sales-line-costs.sql](../../scripts/sql/assert-sales-line-costs.sql) | PASS |
| `20261115091000_historical_cost_sources.sql` | [assert-historical-cost-sources.sql](../../scripts/sql/assert-historical-cost-sources.sql) | PASS |
| `20261116090000_cash_entry_classes.sql` | [assert-cash-entry-classes.sql](../../scripts/sql/assert-cash-entry-classes.sql) | PASS |
| `20261117090000_report_cache.sql` | [assert-report-cache.sql](../../scripts/sql/assert-report-cache.sql) | PASS |

## SQL SePay proximity đã đối chiếu, không chạy lại

Các cột/index có IF NOT EXISTS, constraint có guard theo tên. Đây là idempotence theo tên, không tự sửa một đối tượng trùng tên nhưng sai định nghĩa. Index hiện nhỏ và đã valid; không đề nghị rebuild. Nếu cần tạo mới trên bảng lớn, trình riêng CREATE INDEX CONCURRENTLY bên ngoài transaction và chờ duyệt.

```sql
-- Additive, repeatable; no receipt/payment backfill or edits to existing migrations.
ALTER TABLE "web_store_orders" ADD COLUMN IF NOT EXISTS "ordered_at_verified" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD COLUMN IF NOT EXISTS "match_method" text NOT NULL DEFAULT 'reference';
--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD COLUMN IF NOT EXISTS "matched_order_at" text;
--> statement-breakpoint
DO $check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sepay_transactions'::regclass AND conname='chk_sepay_match_method') THEN
  ALTER TABLE "sepay_transactions" ADD CONSTRAINT "chk_sepay_match_method" CHECK ("match_method" IN ('reference','amount_time','manual'));
 END IF;
END $check$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sepay_pending_time" ON "sepay_transactions" ("transaction_at", "id")
 WHERE "status" IN ('review','unmatched') AND "payment_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sepay_payment_link" ON "sepay_transactions" ("payment_id") WHERE "payment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_orders_created" ON "sales_orders" ("created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_web_orders_created" ON "web_store_orders" ("ordered_at");
```

Kiểm tra đã chạy, kết quả `sepay_proximity_schema_ok`:

```sql
BEGIN TRANSACTION READ ONLY;
-- nguyên nội dung scripts/sql/assert-sepay-proximity.sql
COMMIT;
```

## Deploy và xác nhận

- API đã xanh trên main ban đầu: [42739450512](https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/42739450512), SHA `72cc171fd446313bcb12829886ca3d8518c87651`.
- UI #602 đã xanh: [42727897073, attempt 2](https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/42727897073), SHA `9497db26b5a1f2ab487505900aeb260fdfe80274`. Cây mã UI của SHA này giống main ban đầu72cc171.
- Trong phiên có các merge #604/#605/#606 và deploy tự động mới. Cần lấy trạng thái cuối từ GitHub cùng app-version public; không dùng các run cũ để khẳng định HEAD mới đã lên production.
- Chưa tự rerun: workflow API có SQL ghi cấu hình/seed/cron. Yêu cầu hiện tại bắt buộc chờ xác nhận trước lệnh ghi production.

## PR phòng tái diễn

- 12 assert mới, SELECT/catalog only, không chứa DDL/DML. Workflow bao trong transaction READ ONLY.
- Manifest bao phủ mọi file 202611 và test phát hiện migration mới chưa có mapping/gate.
- Test trên PGlite và PostgreSQL 17 riêng: chạy lặp ở READ ONLY, cố tình xóa/sửa cột/default/index/FK/CHECK/RLS, cấp PUBLIC và thu quyền seed. Các gate phải từ chối đúng tên migration, không tự khôi phục quyền. PGlite không có pg_trgm nên test bắt buộc từ chối; PostgreSQL thật kiểm tra cả đường thành công và thiếu GIN index.
- Gate quyền hiện strict theo seed gốc. **Manager thu quyền hợp lệ cũng làm gate báo thiếu**; không chạy lại seed tự động để xử lý. Chưa có marker lịch sử cho hai migration quyền cũ, không thể phân biệt chưa áp dụng với thu quyền có chủ đích chỉ từ bảng hiện tại. Cần review chính sách này trước merge; PR không thay đổi code phân quyền hay cấp lại quyền.
- Không sửa migration cũ, code ứng dụng, PR #598 hoặc #565. Không merge PR này.
