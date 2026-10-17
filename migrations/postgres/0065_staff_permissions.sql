CREATE TABLE "staff_departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_permission_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"by" text NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_permission_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_position_permissions" (
	"position_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "staff_position_permissions_position_id_permission_pk" PRIMARY KEY("position_id","permission")
);
--> statement-breakpoint
ALTER TABLE "staff_position_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_positions" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "staff_positions" ADD COLUMN "data_scope" text DEFAULT 'position' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_permission_log" ADD CONSTRAINT "staff_permission_log_by_staff_members_id_fk" FOREIGN KEY ("by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_position_permissions" ADD CONSTRAINT "staff_position_permissions_position_id_staff_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."staff_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_departments_name" ON "staff_departments" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_permission_log_at" ON "staff_permission_log" USING btree ("at");--> statement-breakpoint
ALTER TABLE "staff_positions" ADD CONSTRAINT "staff_positions_department_id_staff_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."staff_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_positions_department" ON "staff_positions" USING btree ("department_id");--> statement-breakpoint
-- Dữ liệu ban đầu (docs/PHAN-QUYEN.md): phòng ban + quyền mặc định = đúng quyền đang chạy trước khi có trang phân quyền.
INSERT INTO "staff_departments" ("id", "name", "sort_order", "created_at") VALUES
  ('ban-giam-doc', 'Ban giám đốc', 1, '2026-10-16T00:00:00.000Z'), ('kinh-doanh', 'Kinh doanh', 2, '2026-10-16T00:00:00.000Z'),
  ('kho', 'Kho', 3, '2026-10-16T00:00:00.000Z'), ('ke-toan', 'Kế toán', 4, '2026-10-16T00:00:00.000Z') ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "staff_positions" SET "department_id" = 'ban-giam-doc' WHERE "id" = 'manager';--> statement-breakpoint
UPDATE "staff_positions" SET "department_id" = 'kinh-doanh' WHERE "id" IN ('sale', 'sale-admin', 'sales-ml', 'sales-lock');--> statement-breakpoint
UPDATE "staff_positions" SET "department_id" = 'kho' WHERE "id" = 'warehouse';--> statement-breakpoint
UPDATE "staff_positions" SET "department_id" = 'ke-toan' WHERE "id" = 'accounting';--> statement-breakpoint
UPDATE "staff_positions" SET "data_scope" = 'all' WHERE "id" = 'sale-admin';--> statement-breakpoint
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES
  ('sale', 'page.quotes'),
  ('sale-admin', 'page.quotes'),
  ('sales-ml', 'page.quotes'),
  ('sales-lock', 'page.quotes'),
  ('accounting', 'page.quotes'),
  ('sale', 'page.orders'),
  ('sale-admin', 'page.orders'),
  ('sales-ml', 'page.orders'),
  ('sales-lock', 'page.orders'),
  ('accounting', 'page.orders'),
  ('sale', 'page.contracts'),
  ('sale-admin', 'page.contracts'),
  ('sales-ml', 'page.contracts'),
  ('sales-lock', 'page.contracts'),
  ('accounting', 'page.contracts'),
  ('sale', 'page.deliveries'),
  ('sale-admin', 'page.deliveries'),
  ('sales-ml', 'page.deliveries'),
  ('sales-lock', 'page.deliveries'),
  ('accounting', 'page.deliveries'),
  ('warehouse', 'page.deliveries'),
  ('sale', 'page.receivables'),
  ('sale-admin', 'page.receivables'),
  ('sales-ml', 'page.receivables'),
  ('sales-lock', 'page.receivables'),
  ('accounting', 'page.receivables'),
  ('sale', 'page.customers'),
  ('sale-admin', 'page.customers'),
  ('sales-ml', 'page.customers'),
  ('sales-lock', 'page.customers'),
  ('accounting', 'page.customers'),
  ('sale', 'page.care'),
  ('sale-admin', 'page.care'),
  ('sales-ml', 'page.care'),
  ('sales-lock', 'page.care'),
  ('accounting', 'page.care'),
  ('sale', 'page.stock-requests'),
  ('sale-admin', 'page.stock-requests'),
  ('sales-ml', 'page.stock-requests'),
  ('sales-lock', 'page.stock-requests'),
  ('accounting', 'page.stock-requests'),
  ('sale', 'page.dashboard'),
  ('sale-admin', 'page.dashboard'),
  ('sales-ml', 'page.dashboard'),
  ('sales-lock', 'page.dashboard'),
  ('accounting', 'page.dashboard'),
  ('sale', 'page.flow'),
  ('sale-admin', 'page.flow'),
  ('sales-ml', 'page.flow'),
  ('sales-lock', 'page.flow'),
  ('accounting', 'page.flow'),
  ('sale', 'page.purchases'),
  ('sale-admin', 'page.purchases'),
  ('sales-ml', 'page.purchases'),
  ('sales-lock', 'page.purchases'),
  ('accounting', 'page.purchases'),
  ('warehouse', 'page.purchases'),
  ('warehouse', 'page.packing'),
  ('warehouse', 'page.stock-lookup'),
  ('warehouse', 'purchases.receive'),
  ('accounting', 'purchases.prices'),
  ('accounting', 'purchases.pay'),
  ('accounting', 'suppliers.edit')
  ) AS v(position_id, permission) JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
