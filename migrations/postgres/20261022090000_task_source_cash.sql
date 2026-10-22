-- Việc tự sinh của Sổ quỹ (duyệt phiếu thu/chi, duyệt đổi / trả hàng POS, giải trình / đóng tra soát, ca quên kết): nguồn việc mới "cash".
ALTER TABLE "tasks" DROP CONSTRAINT "chk_tasks_source";
ALTER TABLE "tasks" ADD CONSTRAINT "chk_tasks_source" CHECK ("tasks"."source" IN ('manual', 'quote', 'stock_request', 'order', 'delivery', 'packing', 'contract', 'receivable', 'purchase', 'invoice', 'care', 'transfer', 'cash'));
