import { fold } from '../../../core/text/fold.ts';
import { normTaxCode } from './tax-code.ts';

export interface CustomerIdentity { name?: string | null; phone?: string | null; taxCode?: string | null }
export const customerNameKey = (name: unknown) => fold(name).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
export function customerPhoneKeys(phone: unknown): string[] {
  return [...new Set(String(phone ?? '').split(/[,;/\n]+/).map(value => {
    let n = value.replace(/[^0-9]/g, '');
    if (n.startsWith('0084')) n = '0' + n.slice(4);
    else if (n.startsWith('84') && [11, 12].includes(n.length)) n = '0' + n.slice(2);
    return n.length >= 8 && n.length <= 15 && /[1-9]/.test(n) ? n : '';
  }).filter(Boolean))];
}
export function identityKeys(c: CustomerIdentity) {
  const taxCode = normTaxCode(c.taxCode);
  return { name: customerNameKey(c.name), phone: customerPhoneKeys(c.phone).sort(), taxCode: /[1-9A-Z]/.test(taxCode) ? taxCode : '' };
}
/** Existing duplicates may still edit unrelated fields; only newly changed identities are checked. */
export function changedIdentity(next: CustomerIdentity, previous?: CustomerIdentity): CustomerIdentity {
  if (!previous) return next;
  const a = identityKeys(next), b = identityKeys(previous), out: CustomerIdentity = {};
  if (a.name !== b.name) out.name = next.name;
  if (JSON.stringify(a.phone) !== JSON.stringify(b.phone)) out.phone = next.phone;
  if (a.taxCode !== b.taxCode) out.taxCode = next.taxCode;
  return out;
}
export type IdentityRow = CustomerIdentity & { id: string; name: string; isRetail?: boolean };
/** Shared for bulk imports: update the index as each accepted record enters the batch. */
export function customerIdentityIndex(rows: readonly IdentityRow[]) {
  const all = new Map<string, IdentityRow>(), keys = new Map<string, Set<string>>();
  const tokens = (c: CustomerIdentity) => {
    const k = identityKeys(c);
    return [...(k.taxCode ? ['taxCode:' + k.taxCode] : []), ...k.phone.map(p => 'phone:' + p), ...(k.name ? ['name:' + k.name] : [])];
  };
  const put = (row: IdentityRow) => {
    const old = all.get(row.id);
    if (old) for (const k of tokens(old)) keys.get(k)?.delete(row.id);
    all.set(row.id, row);
    for (const k of tokens(row)) { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k)!.add(row.id); }
  };
  for (const row of rows) put(row);
  return { get: (id: string) => all.get(id), put, find: (input: CustomerIdentity, exceptId?: string) => {
    const matches = new Map<string, Set<string>>();
    for (const key of tokens(input)) for (const id of keys.get(key) || []) {
      if (id === exceptId) continue;
      if (!matches.has(id)) matches.set(id, new Set());
      matches.get(id)!.add(key.split(':')[0]!);
    }
    return [...matches].map(([id, reasons]) => ({ ...all.get(id)!, reasons: [...reasons] }));
  } };
}
