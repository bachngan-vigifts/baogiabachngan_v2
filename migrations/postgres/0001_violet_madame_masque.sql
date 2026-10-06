ALTER TABLE "product_prices" ALTER COLUMN "price" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "price" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "print_fee" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "cost_price" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_order_followups" ALTER COLUMN "total" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_order_followups" ALTER COLUMN "paid" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "quote_order_followups" ALTER COLUMN "balance" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "incoming_shipment_lines" ALTER COLUMN "price" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "incoming_shipment_lines" ALTER COLUMN "print_fee" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "incoming_shipments" ALTER COLUMN "paid_amount" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "work_cash_requests" ALTER COLUMN "amount" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "work_shifts" ALTER COLUMN "opening" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "work_shifts" ALTER COLUMN "actual" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "work_shifts" ALTER COLUMN "expected" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "work_shifts" ALTER COLUMN "difference" SET DATA TYPE double precision;