CREATE TABLE "supplier_order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"at" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"data" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_order_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"line_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text DEFAULT '' NOT NULL,
	"source_no" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"sku" text NOT NULL,
	"quantity" double precision NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_supplier_order_sources_type" CHECK ("supplier_order_sources"."source_type" IN ('quote', 'order', 'stock_request', 'manual')),
	CONSTRAINT "chk_supplier_order_sources_qty" CHECK ("supplier_order_sources"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_order_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_payment_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"due_date" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_supplier_payment_schedules_kind" CHECK ("supplier_payment_schedules"."kind" IN ('deposit', 'installment', 'balance')),
	CONSTRAINT "chk_supplier_payment_schedules_amount" CHECK ("supplier_payment_schedules"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_payment_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"paid_date" text NOT NULL,
	"method" text DEFAULT 'transfer' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"attachment_key" text DEFAULT '' NOT NULL,
	"attachment_name" text DEFAULT '' NOT NULL,
	"client_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"voided_at" text,
	"voided_by" text,
	"void_reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "chk_supplier_payments_method" CHECK ("supplier_payments"."method" IN ('transfer', 'cash', 'other')),
	CONSTRAINT "chk_supplier_payments_amount" CHECK ("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_receipt_lines" (
	"receipt_id" text NOT NULL,
	"line_id" text NOT NULL,
	"sku" text NOT NULL,
	"good_qty" double precision DEFAULT 0 NOT NULL,
	"damaged_qty" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_receipt_lines_receipt_id_line_id_pk" PRIMARY KEY("receipt_id","line_id"),
	CONSTRAINT "chk_supplier_receipt_lines_qty" CHECK ("supplier_receipt_lines"."good_qty" >= 0 AND "supplier_receipt_lines"."damaged_qty" >= 0 AND "supplier_receipt_lines"."good_qty" + "supplier_receipt_lines"."damaged_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_receipt_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_no" text NOT NULL,
	"shipment_id" text NOT NULL,
	"received_date" text NOT NULL,
	"received_by" text NOT NULL,
	"warehouse" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"client_key" text NOT NULL,
	"sapo_status" text DEFAULT 'pending' NOT NULL,
	"sapo_receipt_code" text DEFAULT '' NOT NULL,
	"sapo_note" text DEFAULT '' NOT NULL,
	"sapo_updated_at" text,
	"sapo_updated_by" text,
	"cancelled_at" text,
	"cancelled_by" text,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_supplier_receipts_sapo" CHECK ("supplier_receipts"."sapo_status" IN ('pending', 'done', 'failed', 'not_needed'))
);
--> statement-breakpoint
ALTER TABLE "supplier_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "cancelled_at" text;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "cancel_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "confirmed_on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_order_events" ADD CONSTRAINT "supplier_order_events_shipment_id_incoming_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."incoming_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_sources" ADD CONSTRAINT "supplier_order_sources_shipment_id_incoming_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."incoming_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_sources" ADD CONSTRAINT "supplier_order_sources_line_id_incoming_shipment_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."incoming_shipment_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_schedules" ADD CONSTRAINT "supplier_payment_schedules_shipment_id_incoming_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."incoming_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_shipment_id_incoming_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."incoming_shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_receipt_id_supplier_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."supplier_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_line_id_incoming_shipment_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."incoming_shipment_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_shipment_id_incoming_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."incoming_shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_received_by_staff_members_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_order_events_shipment" ON "supplier_order_events" USING btree ("shipment_id","at");--> statement-breakpoint
CREATE INDEX "idx_supplier_order_sources_source" ON "supplier_order_sources" USING btree ("source_type","source_id","sku");--> statement-breakpoint
CREATE INDEX "idx_supplier_order_sources_shipment" ON "supplier_order_sources" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_payment_schedules_shipment" ON "supplier_payment_schedules" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_payment_schedules_due" ON "supplier_payment_schedules" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_supplier_payments_client_key" ON "supplier_payments" USING btree ("client_key");--> statement-breakpoint
CREATE INDEX "idx_supplier_payments_shipment" ON "supplier_payments" USING btree ("shipment_id","paid_date");--> statement-breakpoint
CREATE INDEX "idx_supplier_receipt_lines_line" ON "supplier_receipt_lines" USING btree ("line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_supplier_receipts_no" ON "supplier_receipts" USING btree ("receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_supplier_receipts_client_key" ON "supplier_receipts" USING btree ("client_key");--> statement-breakpoint
CREATE INDEX "idx_supplier_receipts_shipment" ON "supplier_receipts" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_supplier_receipts_sapo" ON "supplier_receipts" USING btree ("sapo_status");