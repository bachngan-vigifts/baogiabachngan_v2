CREATE TABLE "shipping_carriers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipping_carriers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "ship_to" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "ship_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "ship_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "ship_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "carrier_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_slips" ADD COLUMN "carrier_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD CONSTRAINT "shipping_carriers_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shipping_carriers_name_key" ON "shipping_carriers" USING btree ("name_key");--> statement-breakpoint
ALTER TABLE "packing_slips" ADD CONSTRAINT "chk_packing_slips_ship_to" CHECK ("packing_slips"."ship_to" IN ('customer', 'workshop'));