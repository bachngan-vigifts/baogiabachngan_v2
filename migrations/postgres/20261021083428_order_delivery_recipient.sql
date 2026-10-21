-- Separate the delivery recipient from the buyer. Existing orders keep their current fallback.
ALTER TABLE sales_orders
  ADD COLUMN receiver_name text NOT NULL DEFAULT '',
  ADD COLUMN receiver_phone text NOT NULL DEFAULT '';
