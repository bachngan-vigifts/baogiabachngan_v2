CREATE TABLE "customer_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_customer_contacts_name" CHECK (length(trim("customer_contacts"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_staff" (
	"customer_id" text NOT NULL,
	"member_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "customer_staff_customer_id_member_id_pk" PRIMARY KEY("customer_id","member_id"),
	CONSTRAINT "chk_customer_staff_role" CHECK ("customer_staff"."role" IN ('owner', 'shared'))
);
--> statement-breakpoint
ALTER TABLE "customer_staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff" ADD CONSTRAINT "customer_staff_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff" ADD CONSTRAINT "customer_staff_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff" ADD CONSTRAINT "customer_staff_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_contacts_customer" ON "customer_contacts" USING btree ("customer_id","is_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_staff_owner" ON "customer_staff" USING btree ("customer_id") WHERE "customer_staff"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "idx_customer_staff_member" ON "customer_staff" USING btree ("member_id","role");--> statement-breakpoint
-- Lấy lại nhân viên phụ trách cho khách hàng đã có: người phụ trách đơn đặt hàng gần nhất của khách;
-- khách chưa có đơn thì lấy người phụ trách tài khoản trang khách hàng (nếu có). Chỉ nhân viên / Manager còn hoạt động.
INSERT INTO "customer_staff" ("customer_id", "member_id", "role", "created_by", "created_at")
SELECT x.customer_id, x.member_id, 'owner', x.member_id, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (
  SELECT DISTINCT ON (c.customer_id) c.customer_id, c.member_id
  FROM (
    SELECT o.customer_id, o.owner_id AS member_id, 1 AS pri, o.order_date AS at, o.created_at AS at2
    FROM "sales_orders" o WHERE o.customer_id IS NOT NULL AND o.status <> 'cancelled'
    UNION ALL
    SELECT a.customer_id, a.owner_id, 2, a.updated_at, a.created_at FROM "customer_accounts" a WHERE a.owner_id IS NOT NULL
  ) c
  JOIN "staff_members" m ON m.id = c.member_id AND m.active AND m.role IN ('employee', 'manager')
  ORDER BY c.customer_id, c.pri, c.at DESC, c.at2 DESC
) x
ON CONFLICT DO NOTHING;
