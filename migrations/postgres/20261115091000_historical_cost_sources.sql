-- Chỉ mở rộng nhãn nguồn / lịch sử. Không thay tiền, quyền hay snapshot đang có.
ALTER TABLE sales_line_costs DROP CONSTRAINT IF EXISTS chk_sales_line_costs_source;
ALTER TABLE sales_line_costs ADD CONSTRAINT chk_sales_line_costs_source
  CHECK (source IN ('quote','purchase','purchase_later','manual','purchase_order','catalog_rule'));
ALTER TABLE sales_line_cost_history DROP CONSTRAINT IF EXISTS chk_sales_line_cost_history_reason;
ALTER TABLE sales_line_cost_history ADD CONSTRAINT chk_sales_line_cost_history_reason
  CHECK (reason IN ('create','amend','confirm','pos','pos_edit','adjust','recover'));
