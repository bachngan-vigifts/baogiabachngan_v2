import { createStaffRouter } from '../modules/staff/api/auth-routes.ts';
import { registerQuoteRoutes } from '../modules/quotes/api/routes.ts';
import { registerCustomerRoutes } from '../modules/customers/api/routes.ts';
import { registerCatalogRoutes } from '../modules/catalog/api/routes.ts';
import { registerSapoSyncRoutes } from '../modules/integrations/api/sapo-sync-routes.ts';
import { registerSalesRoutes } from '../modules/sales/api/routes.ts';
import { registerPrintingRoutes } from '../modules/printing/api/routes.ts';
export function createAppRouter() {
  const router = createStaffRouter();
  registerQuoteRoutes(router);
  registerCustomerRoutes(router);
  registerCatalogRoutes(router);
  registerSapoSyncRoutes(router);
  registerSalesRoutes(router);
  registerPrintingRoutes(router);
  return router;
}
