import { createStaffRouter } from '../modules/staff/api/auth-routes.ts';
import { registerQuoteRoutes } from '../modules/quotes/api/routes.ts';
import { registerCustomerRoutes } from '../modules/customers/api/routes.ts';
import { registerCatalogRoutes } from '../modules/catalog/api/routes.ts';
export function createAppRouter() {
  const router = createStaffRouter();
  registerQuoteRoutes(router);
  registerCustomerRoutes(router);
  registerCatalogRoutes(router);
  return router;
}
