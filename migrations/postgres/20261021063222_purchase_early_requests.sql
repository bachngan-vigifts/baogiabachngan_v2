CREATE TABLE "purchase_early_requests" (
 "id" text PRIMARY KEY, "client_key" text NOT NULL, "payload_hash" text NOT NULL,
 "created_by" text NOT NULL REFERENCES "staff_members"("id"), "created_at" text NOT NULL
);
ALTER TABLE "purchase_early_requests" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "idx_purchase_early_requests_key" ON "purchase_early_requests" ("created_by","client_key");
CREATE INDEX "idx_purchase_early_requests_created" ON "purchase_early_requests" ("created_at");
CREATE TABLE "purchase_early_request_lines" (
 "id" text PRIMARY KEY, "request_id" text NOT NULL REFERENCES "purchase_early_requests"("id"),
 "line_no" bigint NOT NULL, "sku" text NOT NULL, "name" text NOT NULL, "unit" text NOT NULL,
 "quantity" bigint NOT NULL, CONSTRAINT "chk_purchase_early_line_qty" CHECK ("quantity">0)
);
ALTER TABLE "purchase_early_request_lines" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "idx_purchase_early_lines_sku" ON "purchase_early_request_lines" ("request_id","sku");
CREATE UNIQUE INDEX "idx_purchase_early_lines_no" ON "purchase_early_request_lines" ("request_id","line_no");
CREATE TABLE "purchase_early_request_allocations" (
 "id" text PRIMARY KEY, "request_line_id" text NOT NULL REFERENCES "purchase_early_request_lines"("id"),
 "purchase_line_id" text NOT NULL REFERENCES "incoming_shipment_lines"("id"), "supplier_id" text NOT NULL REFERENCES "suppliers"("id"),
 "quantity" bigint NOT NULL, "status" text NOT NULL DEFAULT 'pending',
 "responded_by" text REFERENCES "staff_members"("id"), "responded_at" text, "response_note" text NOT NULL DEFAULT '',
 CONSTRAINT "chk_purchase_early_alloc_qty" CHECK ("quantity">0),
 CONSTRAINT "chk_purchase_early_alloc_status" CHECK ("status" IN ('pending','accepted','rejected'))
);
ALTER TABLE "purchase_early_request_allocations" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "idx_purchase_early_alloc_line" ON "purchase_early_request_allocations" ("request_line_id","purchase_line_id");
CREATE INDEX "idx_purchase_early_alloc_supplier" ON "purchase_early_request_allocations" ("supplier_id","status");
CREATE INDEX "idx_purchase_early_alloc_purchase" ON "purchase_early_request_allocations" ("purchase_line_id");
