-- Keep raw Sapo file totals for audit; quantity remains available = on_hand - committed.
-- Nullable for existing catalog/NCC imports. Existing RLS and grants are unchanged.
ALTER TABLE "stock_import_lines" ADD COLUMN IF NOT EXISTS "on_hand" double precision;
--> statement-breakpoint
ALTER TABLE "stock_import_lines" ADD COLUMN IF NOT EXISTS "committed" double precision;
