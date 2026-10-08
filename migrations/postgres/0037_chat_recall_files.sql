CREATE TABLE "chat_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"file_key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "ref_json" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "recalled_at" text;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_attachments_message" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_attachments_key" ON "chat_attachments" USING btree ("file_key");