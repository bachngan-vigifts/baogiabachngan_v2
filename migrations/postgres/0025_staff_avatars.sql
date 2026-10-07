CREATE TABLE "staff_avatars" (
	"member_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"data_url" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_avatars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "staff_avatars" ADD CONSTRAINT "staff_avatars_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_staff_avatars_key" ON "staff_avatars" USING btree ("key");