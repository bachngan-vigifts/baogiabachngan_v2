# Mô hình dữ liệu

> File này được **sinh tự động** từ schema (`npm run docs:data-model`). Đừng sửa tay.

Tổng: **97 bảng**.

Trạng thái: **giữ nguyên** = cùng cột với bản cũ · **đổi** = bản cũ có, đã thêm/bỏ cột · **hợp thức hoá** = bản cũ tự tạo lúc chạy, nay có migration · **mới** = chưa có ở bản cũ.

## core — Dùng chung

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `audit_logs` | 8 | mới |  |

## staff — Nhân viên, chức vụ, đăng nhập

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `staff_auth_attempts` | 3 | giữ nguyên |  |
| `staff_avatars` | 4 | mới |  |
| `staff_credentials` | 5 | giữ nguyên |  |
| `staff_members` | 11 | đổi | thêm: deleted_at, avatar_key |
| `staff_positions` | 2 | giữ nguyên |  |
| `staff_sapo_links` | 4 | giữ nguyên |  |
| `staff_sessions` | 4 | giữ nguyên |  |
| `staff_setup` | 1 | giữ nguyên |  |

## customers — Khách hàng

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `customer_brand_discounts` | 3 | mới |  |
| `customer_contacts` | 11 | mới |  |
| `customer_contract_profiles` | 3 | giữ nguyên |  |
| `customer_staff` | 5 | mới |  |
| `sapo_customers` | 16 | đổi | thêm: approval_status, created_by, approved_by, approved_at; bỏ: discounts |

## catalog — Sản phẩm, giá, kho, tồn kho

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `catalog_versions` | 7 | mới |  |
| `price_policies` | 3 | mới |  |
| `product_edits` | 5 | giữ nguyên |  |
| `product_movements` | 16 | mới |  |
| `product_prices` | 3 | mới |  |
| `product_stock` | 4 | mới |  |
| `products` | 22 | mới |  |
| `stock_import_lines` | 4 | mới |  |
| `stock_imports` | 7 | giữ nguyên |  |
| `warehouses` | 5 | mới |  |

## quotes — Báo giá

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `quote_lines` | 15 | mới |  |
| `quote_order_followups` | 12 | hợp thức hoá | thêm cột: customer_id, kind, total, paid, balance, sapo_order_id, sapo_order_code, sapo_order_url, created_at |
| `quote_revisions` | 6 | mới |  |
| `quote_shares` | 7 | mới |  |
| `staff_notification_reads` | 3 | giữ nguyên |  |
| `staff_quotations` | 18 | đổi | thêm: assignee_id, approval_status, approved_at, approved_by |
| `staff_quote_notifications` | 7 | giữ nguyên |  |

## contracts — Hợp đồng

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `contract_counters` | 7 | giữ nguyên |  |
| `contract_document_numbers` | 3 | giữ nguyên |  |
| `contract_statuses` | 11 | giữ nguyên |  |
| `contract_transfers` | 7 | giữ nguyên |  |

## suppliers — Hàng sắp về và đơn nhà cung cấp

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `incoming_shipment_files` | 11 | mới |  |
| `incoming_shipment_lines` | 29 | mới |  |
| `incoming_shipments` | 42 | mới |  |
| `supplier_accounts` | 4 | mới |  |
| `supplier_contacts` | 7 | mới |  |
| `supplier_stock_request_lines` | 9 | mới |  |
| `supplier_stock_requests` | 12 | mới |  |
| `suppliers` | 13 | mới |  |

## printing — Xưởng in

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `printing_workshops` | 9 | hợp thức hoá |  |

## crm — CRM và bản sao AppSheet VIGIFTS

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `crm_tasks` | 13 | giữ nguyên |  |
| `vigifts_appsheet_actions` | 9 | giữ nguyên |  |
| `vigifts_appsheet_apps` | 7 | giữ nguyên |  |
| `vigifts_appsheet_bots` | 6 | giữ nguyên |  |
| `vigifts_appsheet_fields` | 13 | giữ nguyên |  |
| `vigifts_appsheet_rows` | 9 | giữ nguyên |  |
| `vigifts_appsheet_tables` | 9 | giữ nguyên |  |
| `vigifts_appsheet_views` | 10 | giữ nguyên |  |
| `vigifts_product_image_map` | 8 | hợp thức hoá |  |

## work — Báo cáo công việc, ca, tiền mặt

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `work_assignments` | 4 | giữ nguyên |  |
| `work_audit` | 6 | giữ nguyên |  |
| `work_branches` | 4 | giữ nguyên |  |
| `work_cash_requests` | 11 | giữ nguyên |  |
| `work_reports` | 13 | giữ nguyên |  |
| `work_shifts` | 15 | giữ nguyên |  |
| `work_snapshots` | 5 | giữ nguyên |  |

## notifications — Thông báo web/push

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `staff_web_notification_reads` | 3 | giữ nguyên |  |
| `staff_web_notifications` | 10 | giữ nguyên |  |
| `staff_web_push_subscriptions` | 15 | đổi | thêm: last_status, last_error, last_attempt_at, last_ok_at |
| `web_push_attempts` | 8 | mới |  |
| `web_push_keys` | 4 | mới |  |

## integrations — Sapo

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `sapo_health_monitor_state` | 3 | hợp thức hoá |  |
| `sapo_inventory_doc_lines` | 8 | mới |  |
| `sapo_inventory_docs` | 15 | mới |  |
| `sapo_order_statuses` | 9 | giữ nguyên |  |
| `sapo_runtime_sessions` | 4 | hợp thức hoá |  |

## sales — Đơn hàng, HĐKT, giao hàng, thu tiền, phiếu đóng gói

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `customer_payments` | 11 | mới |  |
| `deliveries` | 17 | mới |  |
| `delivery_lines` | 3 | mới |  |
| `packing_slip_lines` | 11 | mới |  |
| `packing_slip_photos` | 6 | mới |  |
| `packing_slips` | 24 | mới |  |
| `payment_schedules` | 8 | mới |  |
| `sales_contracts` | 19 | mới |  |
| `sales_order_lines` | 11 | mới |  |
| `sales_orders` | 36 | mới |  |
| `shipping_carriers` | 6 | mới |  |

## tasks — Công việc

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `task_comments` | 5 | mới |  |
| `tasks` | 20 | mới |  |

## chat — Tin nhắn nội bộ

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `chat_attachments` | 8 | mới |  |
| `chat_conversations` | 7 | mới |  |
| `chat_members` | 4 | mới |  |
| `chat_messages` | 7 | mới |  |

## care — Chăm sóc khách hàng

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `customer_activities` | 17 | mới |  |

## hr — Nhân sự, lương

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `hr_adjustments` | 8 | mới |  |
| `hr_attendance` | 6 | mới |  |
| `hr_payroll_inputs` | 19 | mới |  |
| `hr_payroll_months` | 8 | mới |  |
| `hr_payroll_settings` | 4 | mới |  |
| `hr_payslips` | 13 | mới |  |
| `hr_salary_profiles` | 22 | mới |  |

## portal — Trang khách hàng

| Bảng | Số cột | Trạng thái | Ghi chú |
|---|---|---|---|
| `customer_accounts` | 7 | mới |  |
| `customer_stock_requests` | 12 | mới |  |
