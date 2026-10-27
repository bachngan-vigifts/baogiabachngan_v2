-- Extend the existing audited return/credit/refund ledger to CRM orders without creating fake POS shifts.
ALTER TABLE pos_returns ADD COLUMN source text NOT NULL DEFAULT 'pos';
--> statement-breakpoint
ALTER TABLE pos_returns ALTER COLUMN register_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pos_returns ALTER COLUMN created_shift_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pos_refunds ALTER COLUMN shift_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pos_returns ADD CONSTRAINT chk_return_source CHECK (
 (source='pos' AND register_id IS NOT NULL AND created_shift_id IS NOT NULL)
 OR (source='crm' AND register_id IS NULL AND created_shift_id IS NULL AND kind='return' AND request_context='after_delivery')
);

--> statement-breakpoint
ALTER TABLE pos_refunds ADD CONSTRAINT chk_refund_cash_shift CHECK (shift_id IS NOT NULL OR (method='transfer' AND cash_entry_id IS NULL));
