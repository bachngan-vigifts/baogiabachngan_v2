-- Nhận JSON chờ đối chiếu, không ghi ngày công hoặc lương.
CREATE TABLE "synctime_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synctime_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "synctime_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"received_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synctime_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_synctime_received" ON "synctime_receipts" USING btree ("received_at");
