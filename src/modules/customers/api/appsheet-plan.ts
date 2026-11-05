import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { customerNameKey, identityKeys } from '../domain/identity.ts';
import { sourceApproval, type AppsheetInput } from '../domain/appsheet-input.ts';
import { CUSTOMER_LIMITS } from '../domain/customer-config.ts';
import { customers, customerContacts } from '../schema.ts';
import { appsheetCustomerLinks, appsheetContactLinks } from '../appsheet-schema.ts';

type Customer = typeof customers.$inferSelect;
type Contact = typeof customerContacts.$inferSelect;
type CustomerLink = typeof appsheetCustomerLinks.$inferSelect;
type ContactLink = typeof appsheetContactLinks.$inferSelect;
type Fields = Record<string, string | boolean | null>;
export interface AppsheetReport {
  kind: 'customer' | 'contact'; rowId: string;
  name: string;
  action: 'create' | 'link' | 'update' | 'unchanged' | 'quarantine' | 'conflict' | 'stale' | 'blocked';
  reason?: string; targetId?: string;
  candidates?: { id: string; name: string; reasons: string[] }[];
  changed?: string[]; preserved?: string[];
  changes?: { field: string; before: string | boolean | null; after: string | boolean | null }[];
}
export interface AppsheetState { customers: Customer[]; contacts: Contact[]; customerLinks: CustomerLink[]; contactLinks: ContactLink[] }
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const blank = (v: unknown) => v === null || v === '' || v === undefined;
const externalId = (kind: string, app: string, table: string, row: string) => 'appsheet-' + sha256Hex(stableJson([kind, app, table, row]));
const scope = <T extends { appId: string; tableName: string; rowId: string }>(rows: T[], appId: string, table: string) =>
  new Map(rows.filter(r => r.appId === appId && r.tableName === table).map(r => [r.rowId, r]));

/** Only fields actually acquired by this source can be overwritten, and only while still equal to the last imported value. */
function reconcile(current: Fields, next: Fields, previous: Fields | undefined, fresh: boolean) {
  const applied = { ...previous }, patch: Fields = {}, preserved: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const owned = Object.hasOwn(applied, key);
    if (fresh || owned && same(current[key], applied[key]) || !owned && blank(current[key])) {
      if (!same(current[key], value)) patch[key] = value;
      applied[key] = value;
    } else if (!same(current[key], value)) preserved.push(key);
  }
  return { applied, patch, preserved };
}
function version(previous: { sourceUpdatedAt: string; sourceJson: string } | undefined, row: { updatedAt: string }, sourceJson: string) {
  if (!previous) return null;
  if (row.updatedAt < previous.sourceUpdatedAt) return 'stale' as const;
  return row.updatedAt === previous.sourceUpdatedAt && sourceJson !== previous.sourceJson ? 'conflict' as const : null;
}
const search = (row: Customer) => fold([row.name, row.contact, row.phone, row.email, row.address, row.taxCode, row.customerCode].join(' '));

/** Pure planner: preview and apply use exactly the same matching and ownership rules. */
export function planAppsheet(input: AppsheetInput, state: AppsheetState, now: string, actorId: string) {
  const customerMap = new Map(state.customers.map(r => [r.id, { ...r }]));
  const contactMap = new Map(state.contacts.map(r => [r.id, { ...r }]));
  const customerLinks = scope(state.customerLinks, input.appId, input.customersTable);
  const contactLinks = scope(state.contactLinks, input.appId, input.contactsTable);
  const customerWrites: Customer[] = [], contactWrites: Contact[] = [];
  const customerLinkWrites: CustomerLink[] = [], contactLinkWrites: ContactLink[] = [];
  const reports: AppsheetReport[] = [];
  const available = new Map<string, string>();
  for (const link of customerLinks.values()) if (link.state === 'active' && link.customerId && customerMap.has(link.customerId)) available.set(link.rowId, link.customerId);
  // Parent rows present in this batch must succeed before their contacts are considered.
  for (const row of input.customers) available.delete(row.rowId);
  for (const row of input.customers) {
    const report: AppsheetReport = { kind: 'customer', rowId: row.rowId, name: row.fields.name, action: 'unchanged' };
    reports.push(report);
    const previous = customerLinks.get(row.rowId), sourceJson = stableJson(row);
    const decision = Object.hasOwn(input.resolutions.customers, row.rowId) ? input.resolutions.customers[row.rowId] : undefined;
    if (previous?.state === 'active' && !previous.customerId) { Object.assign(report, { action: 'blocked', reason: 'Khách CRM đã bị xóa/từ chối; không tự tạo lại.' }); continue; }
    if (previous?.customerId && decision && decision !== previous.customerId) { Object.assign(report, { action: 'conflict', reason: 'Khóa nguồn đã gắn với một khách CRM khác.' }); continue; }
    const outdated = version(previous, row, sourceJson);
    if (outdated) { Object.assign(report, { action: outdated, reason: outdated === 'stale' ? 'Bỏ qua phiên bản nguồn cũ.' : 'Cùng thời điểm nguồn nhưng nội dung khác.' }); continue; }
    const approvalStatus = sourceApproval(row.fields.approvalStatus);
    if (approvalStatus === 'rejected') {
      if (previous?.customerId) { Object.assign(report, { action: 'conflict', reason: 'Nguồn từ chối khách đã có trên CRM; cần Manager xử lý.' }); continue; }
      report.action = 'quarantine'; report.reason = 'Lưu đối soát; khách bị từ chối không được tạo vào danh bạ sử dụng.';
      customerLinkWrites.push({ appId: input.appId, tableName: input.customersTable, rowId: row.rowId, customerId: null, state: 'quarantined',
        sourceCreatedAt: row.createdAt ?? previous?.sourceCreatedAt ?? null, sourceUpdatedAt: row.updatedAt, approvalRaw: row.fields.approvalStatus, sourceJson, appliedJson: '{}', syncedAt: now });
      continue;
    }
    const next: Fields = { ...row.fields, approvalStatus };
    let current = previous?.customerId ? customerMap.get(previous.customerId) : decision && decision !== '$new' ? customerMap.get(decision) : undefined;
    if (decision && decision !== '$new' && !current) { Object.assign(report, { action: 'conflict', reason: 'Không tìm thấy khách CRM đã chọn.' }); continue; }
    const k = identityKeys(row.fields);
    const candidates = [...customerMap.values()].flatMap(candidate => {
      if (candidate.id === current?.id) return [];
      const c = identityKeys(candidate), reasons: string[] = [];
      if (k.taxCode && k.taxCode === c.taxCode) reasons.push('taxCode');
      if (k.phone.some(p => c.phone.includes(p))) reasons.push('phone');
      if (row.fields.customerCode && row.fields.customerCode.toUpperCase() === candidate.customerCode.trim().toUpperCase()) reasons.push('customerCode');
      if (k.name && k.name === c.name) reasons.push('name');
      return reasons.length ? [{ id: candidate.id, name: candidate.name, reasons }] : [];
    });
    if (!current && candidates.some(c => decision !== '$new' || c.reasons.some(r => r !== 'name'))) {
      Object.assign(report, { action: 'conflict', reason: 'Chọn khách CRM tương ứng; không tự gộp theo tên/MST/SĐT.', candidates }); continue;
    }
    const fresh = !current;
    if (!current) {
      const id = externalId('customer', input.appId, input.customersTable, row.rowId);
      if (customerMap.has(id)) throw new AppError(409, 'ID CRM nguồn đã tồn tại nhưng thiếu ánh xạ.');
      current = { id, name: '', contact: '', phone: '', email: '', address: '', taxCode: '', customerCode: '', establishedDate: null,
        customerType: null, dataSource: 'appsheet', search: '', isRetail: false, sourceVersion: 0, syncedAt: now, createdAt: now,
        approvalStatus: 'pending', createdBy: actorId, approvedBy: null, approvedAt: null, depositRate: null, paymentTerm: null, creditLimit: null };
    }
    const oldApplied = previous ? JSON.parse(previous.appliedJson) as Fields : undefined;
    const result = reconcile(current as unknown as Fields, next, oldApplied, fresh);
    const proposed = { ...current, ...result.patch } as Customer;
    // A newly acquired phone/tax/code must not create another identity collision.
    const changedIdentity = ['phone', 'taxCode', 'customerCode'].filter(key => Object.hasOwn(result.patch, key));
    if (!fresh && changedIdentity.length) {
      const mergedKeys = identityKeys(proposed);
      const collision = [...customerMap.values()].some(other => {
        if (other.id === current!.id) return false;
        const o = identityKeys(other);
        return changedIdentity.includes('phone') && mergedKeys.phone.some(p => o.phone.includes(p))
          || changedIdentity.includes('taxCode') && !!mergedKeys.taxCode && mergedKeys.taxCode === o.taxCode
          || changedIdentity.includes('customerCode') && !!proposed.customerCode && proposed.customerCode.toUpperCase() === other.customerCode.trim().toUpperCase();
      });
      if (collision) { Object.assign(report, { action: 'conflict', reason: 'Thông tin cập nhật sẽ trùng MST/SĐT/mã khách của bản khác.' }); continue; }
    }
    if (Object.hasOwn(result.patch, 'approvalStatus')) {
      proposed.approvedBy = proposed.approvalStatus === 'approved' ? actorId : null;
      proposed.approvedAt = proposed.approvalStatus === 'approved' ? now : null;
    }
    proposed.search = search(proposed);
    const changed = Object.keys(result.patch);
    report.action = fresh ? 'create' : !previous ? 'link' : changed.length ? 'update' : 'unchanged';
    report.targetId = proposed.id; report.changed = changed; report.preserved = result.preserved;
    report.changes = changed.map(field => ({ field, before: (current as unknown as Fields)[field] ?? null, after: result.patch[field]! }));
    if (fresh || changed.length) customerWrites.push(proposed);
    customerMap.set(proposed.id, proposed); available.set(row.rowId, proposed.id);
    customerLinkWrites.push({ appId: input.appId, tableName: input.customersTable, rowId: row.rowId, customerId: proposed.id, state: 'active',
      sourceCreatedAt: row.createdAt ?? previous?.sourceCreatedAt ?? null, sourceUpdatedAt: row.updatedAt, approvalRaw: row.fields.approvalStatus,
      sourceJson, appliedJson: stableJson(result.applied), syncedAt: now });
  }
  for (const row of input.contacts) {
    const report: AppsheetReport = { kind: 'contact', rowId: row.rowId, name: row.fields.name, action: 'unchanged' }; reports.push(report);
    const parent = available.get(row.customerRowId), previous = contactLinks.get(row.rowId), sourceJson = stableJson(row);
    if (!parent) { Object.assign(report, { action: 'blocked', reason: 'Khách nguồn chưa được đồng bộ/đối soát thành công.' }); continue; }
    const decision = Object.hasOwn(input.resolutions.contacts, row.rowId) ? input.resolutions.contacts[row.rowId] : undefined;
    if (previous && (!previous.contactId || previous.customerRowId !== row.customerRowId)) { Object.assign(report, { action: 'blocked', reason: 'Liên hệ đã bị xóa hoặc nguồn đổi khách; cần đối soát.' }); continue; }
    if (previous?.contactId && decision && decision !== previous.contactId) { Object.assign(report, { action: 'conflict', reason: 'Khóa nguồn đã gắn liên hệ khác.' }); continue; }
    const outdated = version(previous, row, sourceJson);
    if (outdated) { Object.assign(report, { action: outdated, reason: 'Nguồn cũ hoặc cùng thời điểm nhưng khác nội dung.' }); continue; }
    let current = previous?.contactId ? contactMap.get(previous.contactId) : decision && decision !== '$new' ? contactMap.get(decision) : undefined;
    if (current && current.customerId !== parent || decision && decision !== '$new' && !current) { Object.assign(report, { action: 'conflict', reason: 'Liên hệ được chọn không thuộc khách CRM tương ứng.' }); continue; }
    const phones = identityKeys(row.fields).phone;
    const candidates = [...contactMap.values()].filter(c => c.customerId === parent && (customerNameKey(c.name) === customerNameKey(row.fields.name)
      || identityKeys(c).phone.some(p => phones.includes(p)))).map(c => ({ id: c.id, name: c.name, reasons: ['contact'] }));
    if (!current && candidates.length) { Object.assign(report, { action: 'conflict', reason: 'Chọn liên hệ đã có; không tự gộp danh bạ.', candidates }); continue; }
    const fresh = !current;
    if (fresh && [...contactMap.values()].filter(c => c.customerId === parent).length >= CUSTOMER_LIMITS.contacts) { Object.assign(report, { action: 'conflict', reason: 'Vượt giới hạn người liên hệ của khách.' }); continue; }
    const newId = externalId('contact', input.appId, input.contactsTable, row.rowId);
    if (fresh && contactMap.has(newId)) { Object.assign(report, { action: 'conflict', reason: 'ID liên hệ nguồn đã tồn tại nhưng thiếu ánh xạ.' }); continue; }
    current ??= { id: newId, customerId: parent, name: '', title: '', phone: '', email: '', note: '', isPrimary: false, createdBy: actorId, createdAt: now, updatedAt: now };
    const result = reconcile(current as unknown as Fields, row.fields, previous ? JSON.parse(previous.appliedJson) as Fields : undefined, fresh);
    if (result.patch.isPrimary === true && [...contactMap.values()].some(c => c.customerId === parent && c.id !== current!.id && c.isPrimary)) {
      delete result.patch.isPrimary; delete result.applied.isPrimary; result.preserved.push('isPrimary');
    }
    const proposed = { ...current, ...result.patch, updatedAt: now } as Contact;
    const changed = Object.keys(result.patch);
    report.action = fresh ? 'create' : !previous ? 'link' : changed.length ? 'update' : 'unchanged';
    report.targetId = proposed.id; report.changed = changed; report.preserved = result.preserved;
    report.changes = changed.map(field => ({ field, before: (current as unknown as Fields)[field] ?? null, after: result.patch[field]! }));
    if (fresh || changed.length) contactWrites.push(proposed);
    contactMap.set(proposed.id, proposed);
    contactLinkWrites.push({ appId: input.appId, tableName: input.contactsTable, rowId: row.rowId, contactId: proposed.id, customerRowId: row.customerRowId,
      sourceUpdatedAt: row.updatedAt, sourceJson, appliedJson: stableJson(result.applied), syncedAt: now });
  }
  const summary = Object.fromEntries(['create', 'link', 'update', 'unchanged', 'quarantine', 'conflict', 'stale', 'blocked'].map(action => [action, reports.filter(r => r.action === action).length]));
  // Hash original state, not random IDs or clock values: a stale preview can never apply silently.
  const planHash = sha256Hex(stableJson({ input, state }));
  return { reports, summary, planHash, customerWrites, contactWrites, customerLinkWrites, contactLinkWrites };
}
