import type { AnyDb } from '../../../core/db/client.ts';
import { fold } from '../../../core/text/fold.ts';
import { customerIdentityLock } from '../../customers/api/identity.ts';
import { customerIdentityIndex } from '../../customers/domain/identity.ts';
import { customers } from '../../customers/schema.ts';
import { retailCandidate, retailCode } from '../domain/retail-customer.ts';
/** Insert-only import: no update, merge, deletion, approval or reassignment of existing customers. */
export async function addRetailCustomers(db: AnyDb, raw: unknown[], groups: ReadonlyMap<string, string> = new Map()) {
  const result = { received: raw.length, eligible: 0, added: 0, existing: 0, duplicate: 0, excluded: 0 };
  await db.transaction(async tx => {
    await customerIdentityLock(tx);
    const existing = await tx.select({ id: customers.id, name:customers.name, code: customers.customerCode, phone: customers.phone, taxCode: customers.taxCode }).from(customers);
    const ids = new Set(existing.map(c => c.id)), codes = new Set(existing.map(c => retailCode(c.code)).filter(Boolean)), index=customerIdentityIndex(existing);
    const pending: (typeof customers.$inferInsert)[] = [];
    for (const value of raw) {
      const c = retailCandidate(value, groups);
      if (!c) { result.excluded++; continue; }
      result.eligible++;
      const code = retailCode(c.customerCode);
      if (ids.has(c.id)) { result.existing++; continue; }
      if ((code && codes.has(code)) || index.find(c).length) { result.duplicate++; continue; }
      const now = new Date().toISOString();
      pending.push({ id: c.id, name: c.name, contact: c.contact, phone: c.phone, email: c.email, address: c.address,
        taxCode: c.taxCode, customerCode: c.customerCode, createdAt: c.createdAt, syncedAt: now, sourceVersion: c.version, isRetail: true,
        approvalStatus: 'approved', search: fold([c.name, c.contact, c.phone, c.email, c.address, c.taxCode, c.customerCode].join(' ')) });
      ids.add(c.id); if (code) codes.add(code); index.put(c);
    }
    if (pending.length) {
      const inserted = await tx.insert(customers).values(pending).onConflictDoNothing().returning({ id: customers.id });
      result.added = inserted.length;
      result.existing += pending.length - inserted.length;
    }
  });
  return result;
}
