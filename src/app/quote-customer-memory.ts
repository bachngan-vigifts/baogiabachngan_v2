import { and, eq } from 'drizzle-orm';
import { fold } from '../core/text/fold.ts';
import { auditLogs } from '../core/db/schema.ts';
import { AppError } from '../core/errors.ts';
import type { QuoteCustomerMemory } from '../modules/quotes/api/routes.ts';
import { customers, customerStaff } from '../modules/customers/schema.ts';
import { customerInput } from '../modules/customers/domain/customer-input.ts';
import { changedIdentity, identityKeys } from '../modules/customers/domain/identity.ts';
import { canListRetailCustomers } from '../modules/customers/domain/customer-config.ts';
import { customerIdentityLock, findCustomerDuplicates } from '../modules/customers/api/identity.ts';

const fields = { customer: 'name', contact: 'contact', phone: 'phone', email: 'email', customerTaxCode: 'taxCode', customerAddress: 'address' } as const;
const skipped = (message: string) => ({ status: 'skipped', message: 'Báo giá đã lưu; danh bạ chưa cập nhật: ' + message });
/** Composition-layer bridge: quote + directory changes commit together, with existing customer ownership/approval rules. */
export const rememberQuoteCustomer: QuoteCustomerMemory = async (tx, data, previous, viewer, requested) => {
  const input = Object.fromEntries(Object.entries(fields).map(([from, to]) => [to, String(data[from] || '').trim()]));
  if (!input.name) return skipped('chưa có tên khách.');
  const sameCustomer = previous && previous.customerId === data.customerId;
  const changed = Object.keys(fields).filter(key => sameCustomer ? data[key] !== previous[key] : requested.includes(key));
  if (data.customerId && !changed.length) return { status: 'unchanged' };
  // A name alone is not an identity: do not create repeated directory records for an anonymous quote.
  const keys = identityKeys(input);
  if (!data.customerId && !keys.phone.length && !keys.taxCode) return skipped('thêm số điện thoại hoặc mã số thuế để lưu khách mới.');
  await customerIdentityLock(tx);
  let id = String(data.customerId || '');
  if (!id) {
    const matches = await findCustomerDuplicates(tx, input);
    if (matches.length > 1) return skipped('thông tin trùng nhiều khách; chọn đúng khách từ danh bạ.');
    if (matches.length) {
      const match = matches[0]!, other = identityKeys(match);
      if (!canListRetailCustomers(viewer) && match.isRetail) return skipped('thông tin trùng khách trong danh mục hạn chế.');
      if (keys.taxCode && other.taxCode && keys.taxCode !== other.taxCode || !matches[0]!.reasons.includes('taxCode') && keys.name !== other.name)
        return skipped('số điện thoại/MST trùng khách có thông tin khác; chọn đúng khách từ danh bạ.');
      id = match.id;
    }
  }
  const [profile] = id ? await tx.select().from(customers).where(eq(customers.id, id)).for('update') : [];
  if (id && !profile) return skipped('không tìm thấy hồ sơ khách đã chọn.');
  if (profile) {
    const [owner] = await tx.select({ id: customerStaff.memberId }).from(customerStaff).where(and(eq(customerStaff.customerId, id), eq(customerStaff.memberId, viewer.id), eq(customerStaff.role, 'owner'))).limit(1);
    if (viewer.role !== 'manager' && !owner) return skipped('chỉ người phụ trách khách hoặc Manager được sửa hồ sơ.');
    if (profile.isRetail && !canListRetailCustomers(viewer)) return skipped('không có quyền cập nhật khách trong danh mục hạn chế.');
  }
  // Only edited, nonempty quote fields may replace directory values. Empty fields never erase the profile.
  const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => !profile || changed.includes(key)).map(([from, to]) => [to, input[to]]).filter(([, value]) => !!value));
  let clean: ReturnType<typeof customerInput>['fields'];
  try { clean = customerInput({ ...(profile || {}), ...patch }).fields; }
  catch (e) { if (e instanceof AppError) return skipped(e.message); throw e; }
  const duplicates = await findCustomerDuplicates(tx, changedIdentity(clean, profile), id || undefined);
  if (duplicates.length) return skipped('số điện thoại/MST đã thuộc hồ sơ khác; kiểm tra lại danh bạ.');
  const now = new Date().toISOString(), created = !profile;
  if (created) {
    id = crypto.randomUUID(); const manager = viewer.role === 'manager';
    await tx.insert(customers).values({ id, ...clean, search: fold(Object.values(clean).join(' ')), sourceVersion: 0, syncedAt: now, createdAt: now, dataSource: 'web',
      approvalStatus: manager ? 'approved' : 'pending', createdBy: viewer.id, approvedBy: manager ? viewer.id : null, approvedAt: manager ? now : null });
    await tx.insert(customerStaff).values({ customerId: id, memberId: viewer.id, role: 'owner', createdBy: viewer.id, createdAt: now });
  } else if (Object.entries(patch).some(([key,value]) => profile[key as keyof typeof profile] !== value)) {
    await tx.update(customers).set({ ...clean, search: fold(Object.values(clean).join(' ')), sourceVersion: 0, syncedAt: now }).where(eq(customers.id, id));
  } else { data.customerId = id; return { status: 'linked', message: 'Đã liên kết khách có sẵn trong danh bạ.' }; }
  data.customerId = id;
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: viewer.id, module: 'customers', action: created ? 'create-from-quote' : 'update-from-quote', entityType: 'customers', entityId: id,
    data: JSON.stringify({ quoteNo: data.quoteNo, before: profile ? Object.fromEntries(Object.keys(clean).map(k => [k, profile[k as keyof typeof profile]])) : null, after: clean }), createdAt: now });
  return { status: created ? 'created' : 'updated', message: created && viewer.role !== 'manager' ? 'Đã lưu khách mới vào danh bạ · chờ Manager duyệt.' : 'Đã lưu thông tin khách vào danh bạ.' };
};
