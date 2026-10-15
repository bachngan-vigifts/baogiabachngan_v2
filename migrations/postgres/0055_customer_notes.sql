CREATE TABLE "customer_notes" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_customer_notes_length" CHECK (length("customer_notes"."text") <= 5000),
	CONSTRAINT "chk_customer_notes_revision" CHECK ("customer_notes"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;