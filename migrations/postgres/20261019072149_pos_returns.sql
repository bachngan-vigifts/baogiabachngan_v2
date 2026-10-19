CREATE TABLE pos_returns (
  id text PRIMARY KEY,
  return_no text NOT NULL,
  order_id text NOT NULL REFERENCES sales_orders(id),
  register_id text NOT NULL REFERENCES pos_registers(id),
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  created_shift_id text NOT NULL REFERENCES pos_shifts(id),
  kind text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  requested_service_fee double precision NOT NULL DEFAULT 0,
  requested_shipping_fee double precision NOT NULL DEFAULT 0,
  approved_service_fee double precision NOT NULL DEFAULT 0,
  approved_shipping_fee double precision NOT NULL DEFAULT 0,
  subtotal double precision NOT NULL DEFAULT 0,
  tax double precision NOT NULL DEFAULT 0,
  total double precision NOT NULL DEFAULT 0,
  source_snapshot text NOT NULL,
  request_key text NOT NULL,
  created_by text NOT NULL REFERENCES staff_members(id),
  created_at text NOT NULL,
  approved_by text REFERENCES staff_members(id),
  approved_at text,
  approval_note text NOT NULL DEFAULT '',
  received_by text REFERENCES staff_members(id),
  received_at text,
  received_shift_id text REFERENCES pos_shifts(id),
  credit_effective_at text,
  updated_at text NOT NULL,
  CONSTRAINT uq_pos_return_no UNIQUE (return_no),
  CONSTRAINT uq_pos_return_key UNIQUE (request_key),
  CONSTRAINT chk_pos_return_kind CHECK (kind in ('return','exchange')),
  CONSTRAINT chk_pos_return_status CHECK (status in ('pending','approved','processing','completed','rejected','cancelled')),
  CONSTRAINT chk_pos_return_money CHECK (requested_service_fee>=0 and requested_service_fee=trunc(requested_service_fee) and requested_service_fee<=1000000000000 and requested_shipping_fee>=0 and requested_shipping_fee=trunc(requested_shipping_fee) and requested_shipping_fee<=1000000000000 and approved_service_fee>=0 and approved_service_fee=trunc(approved_service_fee) and approved_service_fee<=1000000000000 and approved_shipping_fee>=0 and approved_shipping_fee=trunc(approved_shipping_fee) and approved_shipping_fee<=1000000000000 and subtotal>=0 and subtotal=trunc(subtotal) and subtotal<=1000000000000 and tax>=0 and tax=trunc(tax) and tax<=1000000000000 and total>=0 and total=trunc(total) and total<=1000000000000),
  CONSTRAINT chk_pos_return_total CHECK (total=subtotal+tax)
);
--> statement-breakpoint
CREATE INDEX idx_pos_returns_lookup ON pos_returns (order_id, register_id, status, created_at);
--> statement-breakpoint
ALTER TABLE pos_returns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE pos_return_lines (
  id text PRIMARY KEY,
  return_id text NOT NULL REFERENCES pos_returns(id),
  order_line_id text NOT NULL REFERENCES sales_order_lines(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  requested_qty double precision NOT NULL,
  received_qty double precision NOT NULL DEFAULT 0,
  restock_qty double precision NOT NULL DEFAULT 0,
  disposition text NOT NULL,
  condition_note text NOT NULL DEFAULT '',
  subtotal double precision NOT NULL,
  tax double precision NOT NULL,
  total double precision NOT NULL,
  CONSTRAINT uq_pos_return_line UNIQUE (return_id, order_line_id),
  CONSTRAINT chk_pos_return_qty CHECK (requested_qty>0 and received_qty>=0 and received_qty<=requested_qty and restock_qty>=0 and restock_qty<=received_qty),
  CONSTRAINT chk_pos_return_line_money CHECK (subtotal>=0 and tax>=0 and total=subtotal+tax and total=trunc(total) and subtotal=trunc(subtotal)),
  CONSTRAINT chk_pos_return_condition CHECK (disposition in ('restock','damaged'))
);
--> statement-breakpoint
CREATE INDEX idx_pos_return_lines_lookup ON pos_return_lines (order_line_id);
--> statement-breakpoint
ALTER TABLE pos_return_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE pos_refunds (
  id text PRIMARY KEY,
  refund_no text NOT NULL,
  return_id text NOT NULL REFERENCES pos_returns(id),
  shift_id text NOT NULL REFERENCES pos_shifts(id),
  drawer_id text NOT NULL REFERENCES cash_drawers(id),
  method text NOT NULL,
  amount double precision NOT NULL,
  cash_entry_id text REFERENCES cash_entries(id),
  reference text NOT NULL DEFAULT '',
  confirmation_note text NOT NULL DEFAULT '',
  confirmed_by text NOT NULL REFERENCES staff_members(id),
  confirmed_at text NOT NULL,
  request_key text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT uq_pos_refund_no UNIQUE (refund_no),
  CONSTRAINT uq_pos_refund_key UNIQUE (request_key),
  CONSTRAINT uq_pos_refund_cash UNIQUE (cash_entry_id),
  CONSTRAINT chk_pos_refund_amount CHECK (amount>0 and amount=trunc(amount) and amount<=1000000000000),
  CONSTRAINT chk_pos_refund_method CHECK ((method='cash' and cash_entry_id is not null) or (method='transfer' and cash_entry_id is null and length(trim(reference))>0))
);
--> statement-breakpoint
CREATE INDEX idx_pos_refunds_lookup ON pos_refunds (return_id, shift_id);
--> statement-breakpoint
ALTER TABLE pos_refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE pos_exchange_allocations (
  id text PRIMARY KEY,
  return_id text NOT NULL REFERENCES pos_returns(id),
  replacement_order_id text REFERENCES sales_orders(id),
  amount double precision NOT NULL,
  payment_id text REFERENCES customer_payments(id),
  status text NOT NULL,
  reserved_at text NOT NULL,
  expires_at text NOT NULL,
  applied_at text,
  created_by text NOT NULL REFERENCES staff_members(id),
  request_key text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT uq_pos_exchange_key UNIQUE (request_key),
  CONSTRAINT uq_pos_exchange_payment UNIQUE (payment_id),
  CONSTRAINT chk_pos_exchange_amount CHECK (amount>0 and amount=trunc(amount) and amount<=1000000000000),
  CONSTRAINT chk_pos_exchange_status CHECK (status in ('reserved','applied','cancelled')),
  CONSTRAINT chk_pos_exchange_applied CHECK (status<>'applied' or (payment_id is not null and replacement_order_id is not null and applied_at is not null))
);
--> statement-breakpoint
CREATE INDEX idx_pos_exchange_allocations_lookup ON pos_exchange_allocations (return_id, status, expires_at);
--> statement-breakpoint
ALTER TABLE pos_exchange_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_moves DROP CONSTRAINT chk_stock_moves_kind;
--> statement-breakpoint
ALTER TABLE stock_moves ADD CONSTRAINT chk_stock_moves_kind CHECK (kind IN ('opening','receipt','issue','adjust','reverse','customer_return'));
--> statement-breakpoint
ALTER TABLE stock_moves DROP CONSTRAINT chk_stock_moves_ref_type;
--> statement-breakpoint
ALTER TABLE stock_moves ADD CONSTRAINT chk_stock_moves_ref_type CHECK (ref_type IN ('opening','supplier_receipt','packing_slip','adjustment','pos_order','pos_delivery','pos_return'));
--> statement-breakpoint
ALTER TABLE cash_entries DROP CONSTRAINT chk_cash_entry_direction;
--> statement-breakpoint
ALTER TABLE cash_entries ADD CONSTRAINT chk_cash_entry_direction CHECK ((kind IN ('other_income','cash_in') AND direction='in') OR (kind IN ('petty_expense','advance','cash_out','customer_refund') AND direction='out') OR (kind='adjustment' AND direction IN ('in','out')));
