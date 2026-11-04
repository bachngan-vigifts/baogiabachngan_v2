-- Read-only monthly business/payroll reporting; no changes to payroll calculations.
ALTER TABLE hr_payslips ADD CONSTRAINT chk_hr_payslips_month
CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
--> statement-breakpoint
CREATE INDEX idx_sales_orders_report_date ON sales_orders (order_date)
WHERE status IN ('confirmed', 'delivering', 'delivered');
