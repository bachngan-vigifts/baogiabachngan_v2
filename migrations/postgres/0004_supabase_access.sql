-- Auth hiện có nằm ở backend. API trình duyệt không được đọc trực tiếp bảng nghiệp vụ.
REVOKE ALL ON TABLE public."audit_logs" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."catalog_versions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."contract_counters" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."contract_document_numbers" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."contract_statuses" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."contract_transfers" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."crm_tasks" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."customer_brand_discounts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."customer_contract_profiles" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."incoming_shipment_files" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."incoming_shipment_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."incoming_shipments" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."price_policies" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."printing_workshops" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."product_edits" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."product_prices" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."product_stock" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."products" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."quote_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."quote_order_followups" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."quote_revisions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."quote_shares" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sapo_customers" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sapo_health_monitor_state" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sapo_order_statuses" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."sapo_runtime_sessions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_auth_attempts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_credentials" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_members" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_notification_reads" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_positions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_quotations" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_quote_notifications" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_sapo_links" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_sessions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_setup" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_web_notification_reads" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_web_notifications" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."staff_web_push_subscriptions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."stock_import_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."stock_imports" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."supplier_accounts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."supplier_contacts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."supplier_stock_request_lines" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."supplier_stock_requests" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."suppliers" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_actions" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_apps" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_bots" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_fields" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_rows" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_tables" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_appsheet_views" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."vigifts_product_image_map" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."warehouses" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_assignments" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_audit" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_branches" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_cash_requests" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_reports" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_shifts" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public."work_snapshots" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_quotation_creator_change() FROM PUBLIC, anon, authenticated;
