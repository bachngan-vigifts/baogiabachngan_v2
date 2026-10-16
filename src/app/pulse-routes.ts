import { sql } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { quotations } from '../modules/quotes/schema.ts';
import { customerPayments, deliveries, packingSlips, salesContracts, salesOrders, stockHolds } from '../modules/sales/schema.ts';
import { expireHolds } from '../modules/sales/api/hold-routes.ts';
import { tasks } from '../modules/tasks/schema.ts';
import { incomingShipments } from '../modules/suppliers/schema.ts';
import { customerActivities } from '../modules/care/schema.ts';
import { customerStockRequests } from '../modules/portal/schema.ts';
import { catalogVersions } from '../modules/catalog/schema.ts';
import { latestNotificationAt } from '../modules/notifications/api/routes.ts';
import { unreadChatCount } from '../modules/chat/api/routes.ts';

/**
 * NHỊP KIỂM TRA THAY ĐỔI (GET /pulse) – trình duyệt gọi MỘT lần mỗi ~30 giây thay cho việc tải lại nhiều danh sách.
 *  - `stamp`: dấu thay đổi chung của các chứng từ chính (lần sửa gần nhất + số dòng để bắt cả thao tác xoá).
 *    Chỉ khi `stamp` đổi, trang mới tải lại dữ liệu đang xem. Không chứa dữ liệu nghiệp vụ nên không cần lọc theo quyền.
 *  - `notifyAt`: thông báo mới nhất của người xem → chuông chỉ tải danh sách khi giá trị này đổi.
 *  - `chatUnread`: số tin nhắn chưa đọc (thay cho GET /chat/unread định kỳ).
 */
export function registerPulseRoutes(router: Router<StaffEnv>) {
  router.get('/pulse', async c => {
    const db = c.env.db, m = (c.state.session as SessionState).member;
    const latest = (col: unknown) => sql`(select coalesce(max(${col}), '') from ${(col as { table: unknown }).table})`;
    const total = (t: unknown) => sql`(select count(*) from ${t})`;
    // Giữ hàng quá hạn: bỏ treo + báo nhân viên (nhịp này chạy khi có người đang dùng hệ thống).
    await expireHolds(c.env).catch(() => 0);
    const [[row], notifyAt, chatUnread] = await Promise.all([
      db.select({
        s: sql<string>`concat_ws('|', ${latest(quotations.updatedAt)}, ${latest(salesOrders.updatedAt)}, ${latest(salesContracts.updatedAt)}, ${latest(deliveries.updatedAt)},
          ${latest(packingSlips.updatedAt)}, ${latest(customerPayments.createdAt)}, ${latest(tasks.updatedAt)}, ${latest(incomingShipments.updatedAt)},
          ${latest(customerActivities.updatedAt)}, ${latest(customerStockRequests.createdAt)}, ${latest(customerStockRequests.answeredAt)}, ${latest(catalogVersions.observedAt)}, ${latest(stockHolds.createdAt)}, ${latest(stockHolds.closedAt)},
          ${total(quotations)}, ${total(salesOrders)}, ${total(tasks)}, ${total(incomingShipments)})`,
      }).from(sql`(select 1) as one`),
      latestNotificationAt(db, m),
      unreadChatCount(db, m.id),
    ]);
    return json({ stamp: row?.s ?? '', notifyAt, chatUnread });
  }, 'business');
}
