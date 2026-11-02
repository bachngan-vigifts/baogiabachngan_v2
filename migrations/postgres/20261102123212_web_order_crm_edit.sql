-- No historical order/stock/payment rewrite. Existing website identity remains authoritative.
ALTER TABLE public.web_store_orders ADD COLUMN IF NOT EXISTS crm_edit_snapshot text NOT NULL DEFAULT '{}';
ALTER TABLE public.web_store_orders ADD COLUMN IF NOT EXISTS crm_order_no text NOT NULL DEFAULT '';
