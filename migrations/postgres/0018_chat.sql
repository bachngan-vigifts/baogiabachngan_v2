CREATE TABLE "chat_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"direct_key" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"last_message_at" text,
	CONSTRAINT "chk_chat_kind" CHECK ("chat_conversations"."kind" IN ('direct', 'group'))
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_members" (
	"conversation_id" text NOT NULL,
	"member_id" text NOT NULL,
	"last_read_at" text,
	"joined_at" text NOT NULL,
	CONSTRAINT "chat_members_conversation_id_member_id_pk" PRIMARY KEY("conversation_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "chat_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_direct_key" ON "chat_conversations" USING btree ("direct_key");--> statement-breakpoint
CREATE INDEX "idx_chat_last_message" ON "chat_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_chat_members_member" ON "chat_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_conv" ON "chat_messages" USING btree ("conversation_id","created_at");