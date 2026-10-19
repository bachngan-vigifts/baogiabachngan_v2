import { sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { fold } from '../../../core/text/fold.ts';
import { normTaxCode } from '../../customers/domain/tax-code.ts';
import { customers } from '../../customers/schema.ts';
import { retailCandidate, retailCode, retailPhone } from '../domain/retail-customer.ts';
/** Insert-only import: no update, merge, deletion, approval or reassignment of existing customers. */
export async function addRetailCustomers(db: AnyDb, raw: unknown[], groups: ReadonlyMap<string, string> = new Map()) {
  const result = { received: raw.length, eligible: 0, added: 0, existing: 0, duplicate: 0, excluded: 0 };
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('retail-customer-import'))`);
    const existing = await tx.select({ id: customers.id, code: customers.customerCode, phone: customers.phone, tax: customers.taxCode }).from(customers);
    const ids = new Set(existing.map(c => c.id)), codes = new Set(existing.map(c => retailCode(c.code)).filter(Boolean)), phones = new Set(existing.map(c => retailPhone(c.phone)).filter(Boolean));
    const taxes = new Set(existing.map(c => normTaxCode(c.tax)).filter(t => /[1-9]/.test(t)));
    for (const value of raw) {
      const c = retailCandidate(value, groups);
      if (!c) { result.excluded++; continue; }
      result.eligible++;
      const code = retailCode(c.customerCode), phone = retailPhone(c.phone), tax = normTaxCode(c.taxCode);
      if (ids.has(c.id)) { result.existing++; continue; }
      if ((code && codes.has(code)) || (phone && phones.has(phone)) || (/[1-9]/.test(tax) && taxes.has(tax))) { result.duplicate++; continue; }
      const now = new Date().toISOString();
      const inserted = await tx.insert(customers).values({ id: c.id, name: c.name, contact: c.contact, phone: c.phone, email: c.email, address: c.address,
        taxCode: c.taxCode, customerCode: c.customerCode, createdAt: c.createdAt, syncedAt: now, sourceVersion: c.version, isRetail: true,
        approvalStatus: 'approved', search: fold([c.name, c.contact, c.phone, c.email, c.address, c.taxCode, c.customerCode].join(' ')) }).onConflictDoNothing().returning({ id: customers.id });
      if (!inserted.length) { result.existing++; continue; }
      ids.add(c.id); if (code) codes.add(code); if (phone) phones.add(phone); if (/[1-9]/.test(tax)) taxes.add(tax); result.added++;
    }
  });
  return result;
}
