import { eq, or, sql } from 'drizzle-orm';
import { customers, customerStaff } from '../schema.ts';
import { canListRetailCustomers } from '../domain/customer-config.ts';

type CustomerViewer = { id: string; role: string; positionId?: string | null };

/** Explicit ownership/sharing applies to both retail and business customers. */
export const directlyAssignedCustomer = (viewer: CustomerViewer) => sql`exists (
  select 1 from ${customerStaff}
  where ${customerStaff.customerId} = ${customers.id}
    and ${customerStaff.memberId} = ${viewer.id}
)`;

/** Keep the general retail directory private; expose only explicitly assigned rows. */
export const customerDirectoryVisibility = (viewer: CustomerViewer) =>
  canListRetailCustomers(viewer) ? undefined : or(eq(customers.isRetail, false), directlyAssignedCustomer(viewer));
