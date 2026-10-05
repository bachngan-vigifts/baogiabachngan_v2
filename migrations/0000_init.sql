CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_actor` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attempts_expires` ON `staff_auth_attempts` (`expires`);--> statement-breakpoint
CREATE TABLE `staff_credentials` (
	`member_id` text PRIMARY KEY NOT NULL,
	`password_hash` text,
	`activation_hash` text,
	`activation_expires` integer,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_members` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text,
	`phone` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'employee' NOT NULL,
	`position_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `staff_positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_email` ON `staff_members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_identity` ON `staff_members` (`identity_id`);--> statement-breakpoint
CREATE INDEX `idx_members_position` ON `staff_members` (`position_id`);--> statement-breakpoint
CREATE TABLE `staff_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_positions_name` ON `staff_positions` (`name`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`version` integer NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_member` ON `staff_sessions` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `staff_sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `staff_setup` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_sapo_links` (
	`sapo_id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text NOT NULL,
	`evidence` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_staff_sapo_member` ON `staff_sapo_links` (`member_id`);--> statement-breakpoint
CREATE TABLE `customer_brand_discounts` (
	`customer_id` text NOT NULL,
	`brand_key` text NOT NULL,
	`percent` real NOT NULL,
	PRIMARY KEY(`customer_id`, `brand_key`),
	FOREIGN KEY (`customer_id`) REFERENCES `sapo_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_customer_discount_brand" CHECK("customer_brand_discounts"."brand_key" IN ('lys', 'minhLong', 'lock')),
	CONSTRAINT "chk_customer_discount_percent" CHECK("customer_brand_discounts"."percent" >= 0 AND "customer_brand_discounts"."percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE `customer_contract_profiles` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `sapo_customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customer_contract_profiles_updated` ON `customer_contract_profiles` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sapo_customers` (
	`created_at` text DEFAULT '' NOT NULL,
	`tax_code` text DEFAULT '' NOT NULL,
	`customer_code` text DEFAULT '' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`address` text NOT NULL,
	`search` text NOT NULL,
	`source_version` integer NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sapo_customers_name` ON `sapo_customers` (`name`);--> statement-breakpoint
CREATE TABLE `catalog_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`format` text DEFAULT 'sapo-catalog-v1' NOT NULL,
	`observed_at` text NOT NULL,
	`product_count` integer NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_catalog_versions_count" CHECK("catalog_versions"."product_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_versions_current` ON `catalog_versions` (`is_current`) WHERE "catalog_versions"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `price_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_policies_name` ON `price_policies` (`name`);--> statement-breakpoint
CREATE TABLE `product_edits` (
	`sku` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_prices` (
	`sku` text NOT NULL,
	`policy_id` text NOT NULL,
	`price` integer,
	PRIMARY KEY(`sku`, `policy_id`),
	FOREIGN KEY (`sku`) REFERENCES `products`(`sku`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `price_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_product_prices" CHECK("product_prices"."price" IS NULL OR "product_prices"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE `product_stock` (
	`sku` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`sku`, `warehouse_id`),
	FOREIGN KEY (`sku`) REFERENCES `products`(`sku`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_product_stock_warehouse` ON `product_stock` (`warehouse_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`sku` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`pattern` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`tax_basis` text DEFAULT '' NOT NULL,
	`tax_in` real,
	`tax_out` real,
	`taxable` integer DEFAULT false NOT NULL,
	`per_carton` real,
	`carton_weight` real,
	`carton_length` real,
	`carton_width` real,
	`carton_height` real,
	`sapo_product_id` text,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chk_products_tax_in" CHECK("products"."tax_in" IS NULL OR ("products"."tax_in" >= 0 AND "products"."tax_in" <= 100)),
	CONSTRAINT "chk_products_tax_out" CHECK("products"."tax_out" IS NULL OR ("products"."tax_out" >= 0 AND "products"."tax_out" <= 100))
);
--> statement-breakpoint
CREATE INDEX `idx_products_brand` ON `products` (`brand`);--> statement-breakpoint
CREATE INDEX `idx_products_name` ON `products` (`name`);--> statement-breakpoint
CREATE TABLE `stock_import_lines` (
	`import_revision` integer NOT NULL,
	`sku` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` real NOT NULL,
	PRIMARY KEY(`import_revision`, `sku`, `warehouse_id`),
	FOREIGN KEY (`import_revision`) REFERENCES `stock_imports`(`revision`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stock_import_lines_sku` ON `stock_import_lines` (`sku`);--> statement-breakpoint
CREATE TABLE `stock_imports` (
	`revision` integer PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'stock' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "chk_warehouses_kind" CHECK("warehouses"."kind" IN ('stock', 'supplier', 'incoming'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_warehouses_name` ON `warehouses` (`name`);--> statement-breakpoint
CREATE TABLE `staff_notification_reads` (
	`notification_id` text NOT NULL,
	`member_id` text NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`notification_id`, `member_id`),
	FOREIGN KEY (`notification_id`) REFERENCES `staff_quote_notifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`assignee_id` text,
	`quote_no` text NOT NULL,
	`quote_type` text NOT NULL,
	`customer` text NOT NULL,
	`quote_date` text,
	`search_text` text,
	`contract_number` text,
	`contract_quote_no` text,
	`has_contract` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quotations_creator_updated` ON `staff_quotations` (`creator_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_quotations_assignee` ON `staff_quotations` (`assignee_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_quotations_created` ON `staff_quotations` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_quotations_quote_date` ON `staff_quotations` (`quote_date`);--> statement-breakpoint
CREATE INDEX `idx_quotations_contract` ON `staff_quotations` (`contract_number`);--> statement-breakpoint
CREATE INDEX `idx_quotations_has_contract` ON `staff_quotations` (`has_contract`,`created_at`);--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`qty` real DEFAULT 0 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`discount_type` text DEFAULT 'percent' NOT NULL,
	`tax_rate` real,
	`print_fee` integer DEFAULT 0 NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`delivery_date` text,
	FOREIGN KEY (`quote_id`) REFERENCES `staff_quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_quote_lines_discount_type" CHECK("quote_lines"."discount_type" IN ('percent', 'amount')),
	CONSTRAINT "chk_quote_lines_qty" CHECK("quote_lines"."qty" >= 0),
	CONSTRAINT "chk_quote_lines_price" CHECK("quote_lines"."price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_lines_order` ON `quote_lines` (`quote_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `idx_quote_lines_sku` ON `quote_lines` (`sku`);--> statement-breakpoint
CREATE TABLE `staff_quote_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`quote_no` text NOT NULL,
	`customer` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `staff_quotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quote_notifications_created` ON `staff_quote_notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `quote_order_followups` (
	`quote_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	`customer_id` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'expected' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`sapo_order_id` text DEFAULT '' NOT NULL,
	`sapo_order_code` text DEFAULT '' NOT NULL,
	`sapo_order_url` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `staff_quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_followup_paid" CHECK("quote_order_followups"."paid" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_followups_customer` ON `quote_order_followups` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_followups_balance` ON `quote_order_followups` (`balance`);--> statement-breakpoint
CREATE TABLE `quote_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `staff_quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_revisions_once` ON `quote_revisions` (`quote_id`,`revision`);--> statement-breakpoint
CREATE TABLE `quote_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`permission` text DEFAULT 'edit' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `staff_quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quote_shares_type" CHECK("quote_shares"."target_type" IN ('member', 'position')),
	CONSTRAINT "chk_quote_shares_permission" CHECK("quote_shares"."permission" IN ('view', 'edit')),
	CONSTRAINT "chk_quote_shares_target" CHECK(length("quote_shares"."target_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_shares_once` ON `quote_shares` (`quote_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_shares_target` ON `quote_shares` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `contract_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`legal_entity` text NOT NULL,
	`last_sequence` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contract_counters_period` ON `contract_counters` (`type`,`year`,`month`,`legal_entity`);--> statement-breakpoint
CREATE TABLE `contract_document_numbers` (
	`quote_number` text NOT NULL,
	`legal_entity` text NOT NULL,
	`contract_number` text NOT NULL,
	PRIMARY KEY(`quote_number`, `legal_entity`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contract_document_number` ON `contract_document_numbers` (`contract_number`);--> statement-breakpoint
CREATE TABLE `contract_statuses` (
	`quote_number` text PRIMARY KEY NOT NULL,
	`contract_number` text,
	`status` text NOT NULL,
	`crm_row_id` text,
	`crm_url` text,
	`customer_name` text,
	`item_count` integer,
	`message` text,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contract_statuses_updated` ON `contract_statuses` (`updated_at`);--> statement-breakpoint
CREATE TABLE `contract_transfers` (
	`quote_number` text PRIMARY KEY NOT NULL,
	`contract_number` text NOT NULL,
	`contract_url` text,
	`message` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contract_transfers_updated` ON `contract_transfers` (`updated_at`);--> statement-breakpoint
CREATE TABLE `incoming_shipment_files` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`kind` text DEFAULT 'signature' NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`downloaded_at` text,
	`downloaded_by` text,
	FOREIGN KEY (`shipment_id`) REFERENCES `incoming_shipments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_incoming_shipment_files_kind" CHECK("incoming_shipment_files"."kind" IN ('signature')),
	CONSTRAINT "chk_incoming_shipment_files_mime" CHECK("incoming_shipment_files"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "chk_incoming_shipment_files_size" CHECK("incoming_shipment_files"."size_bytes" > 0 AND "incoming_shipment_files"."size_bytes" <= 6291456)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incoming_shipment_files_once` ON `incoming_shipment_files` (`shipment_id`,`kind`);--> statement-breakpoint
CREATE TABLE `incoming_shipment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`sku` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`quantity` real NOT NULL,
	`price` integer,
	`manual_price` integer DEFAULT false NOT NULL,
	`tax_rate` real,
	`print_description` text DEFAULT '' NOT NULL,
	`print_fee` integer DEFAULT 0 NOT NULL,
	`design_image` text DEFAULT '' NOT NULL,
	`per_carton` real,
	`carton_weight` real,
	`carton_length` real,
	`carton_width` real,
	`carton_height` real,
	`cartons` real,
	`weight_kg` real,
	`volume_m3` real,
	`purchase_discount` real,
	`supplier_confirmed` integer DEFAULT false NOT NULL,
	`confirmed_purchase_discount` real,
	`promised_date` text DEFAULT '' NOT NULL,
	`supplier_note` text DEFAULT '' NOT NULL,
	`delivery_ready_quantity` real,
	`delivered_quantity` real,
	`stock_synced_at` text,
	FOREIGN KEY (`shipment_id`) REFERENCES `incoming_shipments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_incoming_lines_qty" CHECK("incoming_shipment_lines"."quantity" >= 0),
	CONSTRAINT "chk_incoming_lines_price" CHECK("incoming_shipment_lines"."price" IS NULL OR "incoming_shipment_lines"."price" >= 0),
	CONSTRAINT "chk_incoming_lines_tax" CHECK("incoming_shipment_lines"."tax_rate" IS NULL OR ("incoming_shipment_lines"."tax_rate" >= 0 AND "incoming_shipment_lines"."tax_rate" <= 100)),
	CONSTRAINT "chk_incoming_lines_print_fee" CHECK("incoming_shipment_lines"."print_fee" >= 0),
	CONSTRAINT "chk_incoming_lines_discount" CHECK("incoming_shipment_lines"."purchase_discount" IS NULL OR ("incoming_shipment_lines"."purchase_discount" >= 0 AND "incoming_shipment_lines"."purchase_discount" <= 100)),
	CONSTRAINT "chk_incoming_lines_confirmed_discount" CHECK("incoming_shipment_lines"."confirmed_purchase_discount" IS NULL OR ("incoming_shipment_lines"."confirmed_purchase_discount" >= 0 AND "incoming_shipment_lines"."confirmed_purchase_discount" <= 100))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incoming_shipment_lines_order` ON `incoming_shipment_lines` (`shipment_id`,`line_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incoming_shipment_lines_sku` ON `incoming_shipment_lines` (`shipment_id`,lower("sku"));--> statement-breakpoint
CREATE INDEX `idx_incoming_shipment_lines_by_sku` ON `incoming_shipment_lines` (`sku`);--> statement-breakpoint
CREATE TABLE `incoming_shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_number` text NOT NULL,
	`source` text DEFAULT 'incoming-stock' NOT NULL,
	`approval_status` text DEFAULT 'approved' NOT NULL,
	`warehouse` text NOT NULL,
	`arrival_date` text,
	`filename` text DEFAULT '' NOT NULL,
	`quote_number` text DEFAULT '' NOT NULL,
	`supplier_id` text,
	`supplier_name` text DEFAULT '' NOT NULL,
	`supplier_email` text DEFAULT '' NOT NULL,
	`cc_email` text DEFAULT '' NOT NULL,
	`supplier_internal_order_number` text DEFAULT '' NOT NULL,
	`supplier_status` text DEFAULT 'pending' NOT NULL,
	`supplier_confirmed_at` text,
	`supplier_confirmed_by` text,
	`approved_at` text,
	`approved_by` text,
	`deposit_rate` real,
	`deposit_requested_at` text,
	`deposit_requested_by` text,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`deposit_paid_at` text,
	`deposit_paid_by` text,
	`delivery_note_id` text,
	`delivery_ready_at` text,
	`delivery_ready_by` text,
	`delivery_ready_mode` text,
	`delivery_ready_date` text,
	`supplier_signature_downloaded_at` text,
	`supplier_signature_downloaded_by` text,
	`received_at` text,
	`received_by` text,
	`received_warehouse` text,
	`sapo_receipt_id` text DEFAULT '' NOT NULL,
	`sapo_receipt_code` text DEFAULT '' NOT NULL,
	`stock_synced_at` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`extra` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_incoming_shipments_supplier_required" CHECK("incoming_shipments"."source" <> 'supplier-order' OR "incoming_shipments"."supplier_id" IS NOT NULL),
	CONSTRAINT "chk_incoming_shipments_source" CHECK("incoming_shipments"."source" IN ('incoming-stock', 'supplier-order', 'supplier-delivery-note')),
	CONSTRAINT "chk_incoming_shipments_approval" CHECK("incoming_shipments"."approval_status" IN ('pending', 'approved')),
	CONSTRAINT "chk_incoming_shipments_supplier_status" CHECK("incoming_shipments"."supplier_status" IN ('pending', 'confirmed')),
	CONSTRAINT "chk_incoming_shipments_ready_mode" CHECK("incoming_shipments"."delivery_ready_mode" IN ('full', 'partial')),
	CONSTRAINT "chk_incoming_shipments_deposit" CHECK("incoming_shipments"."deposit_rate" IS NULL OR ("incoming_shipments"."deposit_rate" >= 0 AND "incoming_shipments"."deposit_rate" <= 100)),
	CONSTRAINT "chk_incoming_shipments_paid" CHECK("incoming_shipments"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incoming_shipments_ticket` ON `incoming_shipments` (lower("ticket_number"));--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incoming_shipments_delivery_note` ON `incoming_shipments` (`delivery_note_id`) WHERE "incoming_shipments"."delivery_note_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_incoming_shipments_queue` ON `incoming_shipments` (`source`,`approval_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_incoming_shipments_received` ON `incoming_shipments` (`received_at`);--> statement-breakpoint
CREATE INDEX `idx_incoming_shipments_quote` ON `incoming_shipments` (`quote_number`);--> statement-breakpoint
CREATE INDEX `idx_incoming_shipments_supplier` ON `incoming_shipments` (`supplier_id`,`source`,`approval_status`);--> statement-breakpoint
CREATE INDEX `idx_incoming_shipments_supplier_email` ON `incoming_shipments` (lower("supplier_email"));--> statement-breakpoint
CREATE TABLE `supplier_accounts` (
	`member_id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_supplier_accounts_supplier` ON `supplier_accounts` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `supplier_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`kind` text DEFAULT 'order' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_supplier_contacts_kind" CHECK("supplier_contacts"."kind" IN ('order', 'cc')),
	CONSTRAINT "chk_supplier_contacts_email" CHECK("supplier_contacts"."email" LIKE '%_@_%._%' AND "supplier_contacts"."email" NOT LIKE '% %')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supplier_contacts_once` ON `supplier_contacts` (`supplier_id`,`kind`,lower("email"));--> statement-breakpoint
CREATE TABLE `supplier_stock_request_lines` (
	`request_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`shipment_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`quantity` real NOT NULL,
	`max_quantity` real NOT NULL,
	`arrival_date` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`request_id`, `line_no`),
	FOREIGN KEY (`request_id`) REFERENCES `supplier_stock_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shipment_id`) REFERENCES `incoming_shipments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_stock_request_qty" CHECK("supplier_stock_request_lines"."quantity" > 0 AND "supplier_stock_request_lines"."quantity" <= "supplier_stock_request_lines"."max_quantity")
);
--> statement-breakpoint
CREATE INDEX `idx_supplier_stock_request_lines_shipment` ON `supplier_stock_request_lines` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `supplier_stock_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`supplier_name` text DEFAULT '' NOT NULL,
	`supplier_email` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_by_position_id` text DEFAULT '' NOT NULL,
	`responded_at` text,
	`responded_by` text,
	`response_note` text DEFAULT '' NOT NULL,
	CONSTRAINT "chk_supplier_stock_requests_status" CHECK("supplier_stock_requests"."status" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_supplier_stock_requests_status` ON `supplier_stock_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`tax_code` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	CONSTRAINT "chk_suppliers_name" CHECK(length(trim("suppliers"."name")) > 0 AND length("suppliers"."name_key") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_suppliers_name_key` ON `suppliers` (`name_key`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_active` ON `suppliers` (`active`,`name`);--> statement-breakpoint
CREATE TABLE `printing_workshops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`tax_code` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_printing_workshops_name_key` ON `printing_workshops` (`name_key`);--> statement-breakpoint
CREATE TABLE `crm_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`customer_id` text,
	`quote_number` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_date` text,
	`assigned_to` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_crm_tasks_assignee_status` ON `crm_tasks` (`assigned_to`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_tasks_due_date` ON `crm_tasks` (`due_date`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_actions` (
	`app_id` text NOT NULL,
	`action_name` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`table_name` text DEFAULT '' NOT NULL,
	`action_type` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`condition` text,
	`modifies_data` integer DEFAULT false NOT NULL,
	`action_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`app_id`, `action_name`, `table_name`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_actions_table` ON `vigifts_appsheet_actions` (`app_id`,`table_name`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_app_id` text NOT NULL,
	`source_version` text DEFAULT '' NOT NULL,
	`app_definition_json` text NOT NULL,
	`exported_at` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_bots` (
	`app_id` text NOT NULL,
	`bot_name` text NOT NULL,
	`event_name` text DEFAULT '' NOT NULL,
	`process_name` text DEFAULT '' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`bot_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`app_id`, `bot_name`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_bots_disabled` ON `vigifts_appsheet_bots` (`app_id`,`disabled`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_fields` (
	`app_id` text NOT NULL,
	`table_name` text NOT NULL,
	`field_id` text NOT NULL,
	`field_name` text NOT NULL,
	`field_type` text DEFAULT '' NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`is_key` integer DEFAULT false NOT NULL,
	`is_label` integer DEFAULT false NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_virtual` integer DEFAULT false NOT NULL,
	`expression_json` text DEFAULT '{}' NOT NULL,
	`field_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`app_id`, `table_name`, `field_id`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_fields_name` ON `vigifts_appsheet_fields` (`app_id`,`table_name`,`field_name`);--> statement-breakpoint
CREATE TABLE `vigifts_product_image_map` (
	`product_id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`product_name` text NOT NULL,
	`image_file_name` text NOT NULL,
	`image_source_path` text NOT NULL,
	`image_url` text,
	`sync_status` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_product_image_map_sku` ON `vigifts_product_image_map` (`sku`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_rows` (
	`app_id` text NOT NULL,
	`table_name` text NOT NULL,
	`tuple_id` text NOT NULL,
	`values_json` text NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`source_created_at` text,
	`source_updated_at` text,
	`imported_at` text NOT NULL,
	PRIMARY KEY(`app_id`, `table_name`, `tuple_id`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_rows_table` ON `vigifts_appsheet_rows` (`app_id`,`table_name`);--> statement-breakpoint
CREATE INDEX `idx_vigifts_rows_search` ON `vigifts_appsheet_rows` (`search_text`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_tables` (
	`app_id` text NOT NULL,
	`table_name` text NOT NULL,
	`safe_name` text NOT NULL,
	`base_id` text NOT NULL,
	`frame_id` text NOT NULL,
	`schema_name` text NOT NULL,
	`update_mode` integer DEFAULT 0 NOT NULL,
	`allowed_updates` integer DEFAULT 0 NOT NULL,
	`source_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`app_id`, `table_name`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vigifts_tables_frame` ON `vigifts_appsheet_tables` (`app_id`,`frame_id`);--> statement-breakpoint
CREATE INDEX `idx_vigifts_tables_safe` ON `vigifts_appsheet_tables` (`safe_name`);--> statement-breakpoint
CREATE TABLE `vigifts_appsheet_views` (
	`app_id` text NOT NULL,
	`view_name` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`position` text DEFAULT '' NOT NULL,
	`table_name` text DEFAULT '' NOT NULL,
	`action` text DEFAULT '' NOT NULL,
	`action_type` text DEFAULT '' NOT NULL,
	`view_order` integer DEFAULT 0 NOT NULL,
	`show_if` text,
	`view_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`app_id`, `view_name`),
	FOREIGN KEY (`app_id`) REFERENCES `vigifts_appsheet_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vigifts_views_position` ON `vigifts_appsheet_views` (`app_id`,`position`,`view_order`);--> statement-breakpoint
CREATE TABLE `work_assignments` (
	`member_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`sapo_account_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `branch_id`),
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `work_branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_branch_account` ON `work_assignments` (`branch_id`,`sapo_account_id`);--> statement-breakpoint
CREATE TABLE `work_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_work_audit_entity` ON `work_audit` (`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `work_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`keeper_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_cash_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `work_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_work_cash_requests_shift` ON `work_cash_requests` (`shift_id`,`status`);--> statement-breakpoint
CREATE TABLE `work_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`member_id` text NOT NULL,
	`position_id` text NOT NULL,
	`phase` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`data` text NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`submitted_at` text,
	`reviewed_by` text,
	`review_note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `work_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_report_once` ON `work_reports` (`shift_id`,`member_id`,`phase`);--> statement-breakpoint
CREATE INDEX `idx_work_reports_member` ON `work_reports` (`member_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_work_reports_status` ON `work_reports` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `work_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`work_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`label` text NOT NULL,
	`keeper_id` text,
	`opening` integer,
	`actual` integer,
	`expected` integer,
	`difference` integer,
	`cash_status` text DEFAULT 'not_opened' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `work_branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_shift_period` ON `work_shifts` (`branch_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_work_branch_time` ON `work_shifts` (`branch_id`,`ends_at`);--> statement-breakpoint
CREATE TABLE `work_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`member_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_work_snapshot_owner` ON `work_snapshots` (`member_id`,`shift_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_web_notification_reads` (
	`notification_id` text NOT NULL,
	`member_id` text NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`notification_id`, `member_id`),
	FOREIGN KEY (`notification_id`) REFERENCES `staff_web_notifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_web_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`target_role` text DEFAULT 'manager',
	`target_member_id` text,
	`actor_id` text,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_web_notifications_created` ON `staff_web_notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_web_notifications_target` ON `staff_web_notifications` (`target_role`,`target_member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_web_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_seen_at` text,
	`disabled_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `staff_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_web_push_endpoint` ON `staff_web_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_web_push_member` ON `staff_web_push_subscriptions` (`member_id`,`disabled_at`);--> statement-breakpoint
CREATE TABLE `sapo_health_monitor_state` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sapo_order_statuses` (
	`quote_number` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`sapo_order_id` text,
	`sapo_order_code` text,
	`sapo_order_url` text,
	`customer_name` text,
	`message` text,
	`payload_json` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sapo_order_statuses_updated` ON `sapo_order_statuses` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sapo_runtime_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_cookie` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
