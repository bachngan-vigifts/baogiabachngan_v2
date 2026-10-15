ALTER TABLE "sapo_customers" ADD COLUMN "deposit_rate" double precision;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "payment_term" text;--> statement-breakpoint
ALTER TABLE "sapo_customers" ADD COLUMN "credit_limit" double precision;