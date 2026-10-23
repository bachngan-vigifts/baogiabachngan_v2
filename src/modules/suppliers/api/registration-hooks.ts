import { and, eq } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { suppliers, supplierAccounts } from '../schema.ts';

/** Đăng ký tài khoản NCC qua link mời (portal/api/registration.ts): đọc / ghi liên kết tài khoản ↔ NCC. Nối ở src/app/router.ts. */
type Db = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export async function boundSupplier(db: Db, memberId: string) {
  const [row] = await db.select({ id: supplierAccounts.supplierId }).from(supplierAccounts).where(eq(supplierAccounts.memberId, memberId));
  return row?.id;
}
export async function bindSupplier(db: Db, p: { memberId: string; supplierId: string; actorId: string; at: string }) {
  await db.insert(supplierAccounts).values({ memberId: p.memberId, supplierId: p.supplierId, createdBy: p.actorId, createdAt: p.at });
}
export async function supplierOf(db: Db, memberId: string, supplierId: string) {
  const [r] = await db.select({ name: suppliers.name, active: suppliers.active }).from(supplierAccounts)
    .innerJoin(suppliers, eq(suppliers.id, supplierAccounts.supplierId)).where(and(eq(supplierAccounts.memberId, memberId), eq(supplierAccounts.supplierId, supplierId))).limit(1);
  return r;
}
