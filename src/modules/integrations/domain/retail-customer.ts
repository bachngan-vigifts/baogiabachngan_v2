import { fold } from '../../../core/text/fold.ts';
import { mapSapoCustomer } from './sapo-mapping.ts';
export const retailPhone = (value: unknown) => {
  let s = String(value ?? '').replace(/[^0-9]/g, '');
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  return /^0[0-9]{9,10}$/.test(s) ? s : '';
};
export const retailCode = (value: unknown) => fold(value).replace(/\s+/g, '');
export function retailCandidate(raw: unknown, groups: ReadonlyMap<string, string> = new Map()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, any>, mapped = mapSapoCustomer(c, Date.now());
  if (!mapped) return null;
  // Sapo versions also expose tax_number; never mistake a taxed business for a no-tax individual.
  if (!mapped.taxCode) mapped.taxCode = String(c.tax_number ?? c.taxNumber ?? '').trim().slice(0, 100);
  const names = [c.group_name, c.customer_group_name, c.group?.name, c.customer_group?.name,
    groups.get(String(c.group_id ?? c.customer_group_id ?? '')),
    ...(Array.isArray(c.groups) ? c.groups.map((g: any) => typeof g === 'string' ? g : g?.name) : []),
    ...(Array.isArray(c.customer_groups) ? c.customer_groups.map((g: any) => g?.name) : [])].map(fold);
  const grouped = names.some(n => /(^|\b)khach (hang )?le(\b|$)/.test(n));
  const business = c.is_company === true || c.is_business === true || !!String(c.company ?? c.company_name ?? '').trim() ||
    /^(cong ty|cty|doanh nghiep|hop tac xa|htx|truong|benh vien|uy ban|ubnd|chi nhanh|ho kinh doanh)\b/.test(fold(mapped.name)) ||
    ['business', 'company', 'organization', 'corporate', 'doanh nghiep'].includes(fold(c.customer_type ?? c.type));
  return grouped || (!/[1-9]/.test(mapped.taxCode) && !business) ? mapped : null;
}
