import { createStaffRouter } from '../modules/staff/api/auth-routes.ts';
import { registerQuoteRoutes } from '../modules/quotes/api/routes.ts';
import { registerCustomerRoutes } from '../modules/customers/api/routes.ts';
import { registerCatalogRoutes } from '../modules/catalog/api/routes.ts';
import { registerSapoSyncRoutes } from '../modules/integrations/api/sapo-sync-routes.ts';
import { registerSalesRoutes } from '../modules/sales/api/routes.ts';
import { registerPrintingRoutes } from '../modules/printing/api/routes.ts';
import { registerPortalRoutes } from '../modules/portal/api/routes.ts';
import { registerNotificationRoutes } from '../modules/notifications/api/routes.ts';
import { registerTaskRoutes } from '../modules/tasks/api/routes.ts';
import { registerChatRoutes } from '../modules/chat/api/routes.ts';
import { registerCustomerHubRoutes } from '../modules/customer-hub/api/routes.ts';
import { registerHrRoutes } from '../modules/hr/api/routes.ts';
import { registerStaffHubRoutes, memberRevenues } from '../modules/staff-hub/api/routes.ts';
export function createAppRouter() {
  const router = createStaffRouter();
  registerQuoteRoutes(router);
  registerCustomerRoutes(router);
  registerCatalogRoutes(router);
  registerSapoSyncRoutes(router);
  registerSalesRoutes(router);
  registerPrintingRoutes(router);
  registerPortalRoutes(router);
  registerNotificationRoutes(router);
  registerTaskRoutes(router);
  registerChatRoutes(router);
  registerCustomerHubRoutes(router);
  registerHrRoutes(router, { revenueOf: memberRevenues }); // thưởng KPI DS / thưởng quý cần DS đơn hàng (staff-hub) mà hr không phụ thuộc bán hàng
  registerStaffHubRoutes(router);
  return router;
}
