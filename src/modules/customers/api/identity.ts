import { and, asc, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { foldSql } from '../../../core/text/fold.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { customers } from '../schema.ts';
import { NORM_TAX_SQL } from '../domain/tax-code.ts';
import { customerIdentityIndex, identityKeys, type CustomerIdentity } from '../domain/identity.ts';

type Db = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export const customerIdentityLock = (db: Db) => db.execute(sql`select pg_advisory_xact_lock(hashtext('customer-identity'))`);
export const identityColumns = { id: customers.id, name: customers.name, phone: customers.phone, taxCode: customers.taxCode, isRetail: customers.isRetail };
export async function findCustomerDuplicates(db: Db, input: CustomerIdentity, exceptId?: string) {
  const k = identityKeys(input);
  const numeric = sql`regexp_replace(token, '[^0-9]', '', 'g')`;
  const phone = sql`case when ${numeric} like '0084%' then '0' || substr(${numeric}, 5)
    when ${numeric} like '84%' and length(${numeric}) in (11,12) then '0' || substr(${numeric}, 3) else ${numeric} end`;
  const name = sql`trim(regexp_replace(${foldSql(sql`normalize(${customers.name}, NFC)`)}, '[^a-z0-9]+', ' ', 'g'))`;
  const conditions = [k.taxCode ? sql`${sql.raw(NORM_TAX_SQL('tax_code'))} = ${k.taxCode}` : undefined,
    k.name ? sql`${name} = ${k.name}` : undefined,
    k.phone.length ? sql`exists(select 1 from regexp_split_to_table(${customers.phone}, E'[,;/\\n]+') token where ${phone} in (${sql.join(k.phone.map(p => sql`${p}`), sql`, `)}))` : undefined].filter(Boolean);
  if (!conditions.length) return [];
  const rows = await db.select(identityColumns).from(customers).where(and(exceptId ? ne(customers.id, exceptId) : undefined, or(...conditions)))
    .orderBy(asc(customers.name), asc(customers.id)).limit(20);
  return customerIdentityIndex(rows).find(input, exceptId);
}
export function rejectDuplicate(matches: Awaited<ReturnType<typeof findCustomerDuplicates>>, seeRetail = true) {
  if (!matches.length) return;
  const match = matches[0]!, labels: Record<string, string> = { taxCode: 'MST', phone: 'số điện thoại', name: 'tên khách hàng' };
  throw new AppError(409, `Đã có khách "${match.isRetail && !seeRetail ? 'Khách hàng trong danh mục hạn chế' : match.name}" trùng ${match.reasons.map(r => labels[r]).join(', ')}. Hãy chọn khách có sẵn.`,
    matches.some(m => m.reasons.includes('taxCode')) ? 'CUSTOMER_TAX_DUPLICATE' : 'CUSTOMER_IDENTITY_DUPLICATE');
}
