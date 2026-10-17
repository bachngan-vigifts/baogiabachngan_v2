-- Đơn hàng / HĐKT tự giữ hàng (docs/BAN-HANG.md "Giữ hàng"). Đơn có từ trước: không giữ (false); đơn lập từ nay: giữ (mặc định true).
ALTER TABLE "sales_orders" ADD COLUMN "sapo_pushed_at" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "holds_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ALTER COLUMN "holds_stock" SET DEFAULT true;
