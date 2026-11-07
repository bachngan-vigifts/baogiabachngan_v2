import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { customerBrandDiscounts, customerContacts, customerContractProfiles, customerDebtNotes, customerNotes, customers, customerStaff } from '../../customers/schema.ts';
import { appsheetCustomerLinks } from '../../customers/appsheet-schema.ts';
import { customerIdentityLock } from '../../customers/api/identity.ts';
import { NORM_TAX_SQL, normTaxCode, pickKeeper } from '../../customers/domain/tax-code.ts';
import { quotations, quoteOrderFollowups } from '../../quotes/schema.ts';
import { customerPayments, salesContracts, salesOrders } from '../../sales/schema.ts';
import { customerAccounts, customerStockRequests } from '../../portal/schema.ts';
import { customerActivities } from '../../care/schema.ts';
import { customerCampaignTargets } from '../schema.ts';

type Ctx = RouteContext<StaffEnv>;
type Db = StaffEnv['db'];
const requireManager = (c: Ctx) => {
  if ((c.state.session as SessionState).member.role !== 'manager') throw new AppError(403, 'Chỉ Manager được gộp khách hàng trùng.');
};
const NORM = sql.raw(NORM_TAX_SQL('sapo_customers.tax_code'));
const n = (q: ReturnType<typeof sql>) => sql<number>`(${q})`.mapWith(Number);

/** Các nhóm khách trùng MST, mỗi khách kèm số người liên hệ / chứng từ để chọn bản giữ lại. */
export async function duplicateGroups(db: Db) {
  const rows = await db.select({
    id: customers.id, name: customers.name, contact: customers.contact, phone: customers.phone, email: customers.email, address: customers.address,
    taxCode: customers.taxCode, customerCode: customers.customerCode, createdAt: customers.createdAt, tax: sql<string>`${NORM}`,
    contacts: n(sql`select count(*) from ${customerContacts} where ${customerContacts.customerId} = ${customers.id}`),
    hasOwner: sql<boolean>`exists (select 1 from ${customerStaff} where ${customerStaff.customerId} = ${customers.id} and ${customerStaff.role} = 'owner')`,
    refs: n(sql`(select count(*) from ${salesOrders} where ${salesOrders.customerId} = ${customers.id})
      + (select count(*) from ${salesContracts} where ${salesContracts.customerId} = ${customers.id})
      + (select count(*) from ${customerPayments} where ${customerPayments.customerId} = ${customers.id})
      + (select count(*) from ${customerActivities} where ${customerActivities.customerId} = ${customers.id})
      + (select count(*) from ${quotations} where (${quotations.data}::jsonb ->> 'customerId') = ${customers.id})`),
  }).from(customers).where(and(ne(customers.approvalStatus, 'rejected'),
    sql`${NORM} in (select ${NORM} from ${customers} where ${NORM} <> '' and ${customers.approvalStatus} <> 'rejected' group by 1 having count(*) > 1)`))
    .orderBy(sql`${NORM}`, customers.createdAt);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.tax, [...(groups.get(r.tax) ?? []), { ...r, hasOwner: !!r.hasOwner }]);
  return [...groups.entries()].map(([taxCode, members]) => {
    const keep = pickKeeper(members);
    return { taxCode, keepId: keep.id, customers: members.map(m => ({ ...m, keep: m.id === keep.id })) };
  });
}

/**
 * Gộp `dropIds` vào `keepId`: chuyển mọi chứng từ / lịch sử / người liên hệ / phụ trách sang khách giữ lại,
 * bù thông tin còn trống, rồi xoá các bản trùng. Chạy trong một transaction.
 */
export async function mergeCustomers(db: Db, keepId: string, dropIds: string[], actorId: string) {
  const ids = [...new Set(dropIds)].filter(id => id && id !== keepId);
  if (!ids.length) return 0;
  await db.transaction(async tx => {
    await customerIdentityLock(tx);
    const all = await tx.select().from(customers).where(inArray(customers.id, [keepId, ...ids])).for('update');
    const keep = all.find(r => r.id === keepId); if (!keep) throw new AppError(404, 'Không tìm thấy khách hàng giữ lại.');
    const drops = all.filter(r => r.id !== keepId);
    if (drops.length !== ids.length) throw new AppError(404, 'Không tìm thấy khách hàng cần gộp.');
    if (drops.some(d => normTaxCode(d.taxCode) !== normTaxCode(keep.taxCode) || !normTaxCode(keep.taxCode))) throw new AppError(400, 'Chỉ gộp được các khách cùng mã số thuế.');

    // Bù ô còn trống của khách giữ lại bằng thông tin của bản trùng.
    const fill = Object.fromEntries((['contact', 'phone', 'email', 'address', 'customerCode', 'customerType', 'establishedDate'] as const)
      .map(k => [k, keep[k]?.trim() ? keep[k] : drops.map(d => d[k]).find(v => v?.trim()) ?? keep[k]]));
    const merged = { ...keep, ...fill };
    // Số ngày công nợ: bù khi khách giữ lại chưa có. Người đại diện bù ở dưới, sau khi người liên hệ đã chuyển sang khách giữ lại.
    const paymentDays = keep.paymentDays ?? drops.map(d => d.paymentDays).find(v => v !== null && v !== undefined) ?? null;
    await tx.update(customers).set({ ...fill, paymentDays, search: fold([merged.name, merged.contact, merged.phone, merged.email, merged.address, merged.taxCode, merged.customerCode].join(' ')),
      ...(keep.approvalStatus !== 'approved' && drops.some(d => d.approvalStatus === 'approved')
        ? { approvalStatus: 'approved' as const, rejectReason: null, rejectedBy: null, rejectedAt: null } : {}) })
      .where(eq(customers.id, keepId));

    // Người liên hệ: chuyển hết; khách giữ lại đã có liên hệ chính thì bỏ cờ chính của bản chuyển sang.
    const [primary] = await tx.select({ id: customerContacts.id }).from(customerContacts).where(and(eq(customerContacts.customerId, keepId), eq(customerContacts.isPrimary, true))).limit(1);
    await tx.update(customerContacts).set({ customerId: keepId, ...(primary ? { isPrimary: false } : {}) }).where(inArray(customerContacts.customerId, ids));
    // Người đại diện: giữ của khách giữ lại; chưa có thì lấy của bản trùng (liên hệ đó đã nằm trong danh bạ khách giữ lại).
    if (!keep.representativeContactId) {
      const representative = drops.map(d => d.representativeContactId).find(v => !!v);
      if (representative) await tx.update(customers).set({ representativeContactId: representative }).where(eq(customers.id, keepId));
    }

    // Phụ trách / chia sẻ: giữ người phụ trách của khách giữ lại; chưa có thì lấy của bản trùng; còn lại thành chia sẻ.
    const staff = await tx.select().from(customerStaff).where(inArray(customerStaff.customerId, [keepId, ...ids]));
    const have = new Set(staff.filter(s => s.customerId === keepId).map(s => s.memberId));
    let hasOwner = staff.some(s => s.customerId === keepId && s.role === 'owner');
    for (const s of staff.filter(s => s.customerId !== keepId).sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))) {
      if (have.has(s.memberId)) continue;
      const role = s.role === 'owner' && !hasOwner ? 'owner' as const : 'shared' as const; if (role === 'owner') hasOwner = true;
      await tx.insert(customerStaff).values({ ...s, customerId: keepId, role }); have.add(s.memberId);
    }
    // Chiết khấu nhãn hàng / hồ sơ hợp đồng: chỉ lấy phần khách giữ lại chưa có.
    for (const d of await tx.select().from(customerBrandDiscounts).where(inArray(customerBrandDiscounts.customerId, ids)))
      await tx.insert(customerBrandDiscounts).values({ ...d, customerId: keepId }).onConflictDoNothing();
    const [profile] = await tx.select({ id: customerContractProfiles.customerId }).from(customerContractProfiles).where(eq(customerContractProfiles.customerId, keepId));
    if (!profile) {
      const [first] = await tx.select({ id: customerContractProfiles.customerId }).from(customerContractProfiles).where(inArray(customerContractProfiles.customerId, ids)).limit(1);
      if (first) await tx.update(customerContractProfiles).set({ customerId: keepId }).where(eq(customerContractProfiles.customerId, first.id));
    }

    // Giữ ghi chú của mọi bản trùng; không để cascade xoá mất nội dung nội bộ.
    const notes = await tx.select().from(customerNotes).where(inArray(customerNotes.customerId, [keepId, ...ids])).for('update');
    const nonempty = notes.filter(n => n.text.trim());
    if (notes.some(n => ids.includes(n.customerId))) {
      const texts = [...new Set(nonempty.map(n => n.text))];
      const text = texts.length <= 1 ? texts[0] || '' : nonempty.map(n => `[${all.find(c => c.id === n.customerId)!.name}]\n${n.text}`).join('\n\n');
      if (text.length > 5000) throw new AppError(409, 'Ghi chú các khách cần gộp vượt 5.000 ký tự. Rút gọn ghi chú trước khi gộp để không mất nội dung.');
      const currentNote = notes.find(n => n.customerId === keepId);
      const values = { text, revision: (currentNote?.revision ?? 0) + 1, updatedBy: actorId, updatedAt: new Date().toISOString() };
      await tx.insert(customerNotes).values({ customerId: keepId, ...values }).onConflictDoUpdate({ target: customerNotes.customerId, set: values });
    }

    // Ghi chú công nợ cũ: giữ nội dung của mọi bản trùng, như ghi chú chung (không để cascade xoá mất).
    const debtNotes = await tx.select().from(customerDebtNotes).where(inArray(customerDebtNotes.customerId, [keepId, ...ids])).for('update');
    const debtNonempty = debtNotes.filter(n => n.text.trim());
    if (debtNotes.some(n => ids.includes(n.customerId))) {
      const texts = [...new Set(debtNonempty.map(n => n.text))];
      const text = texts.length <= 1 ? texts[0] || '' : debtNonempty.map(n => `[${all.find(c => c.id === n.customerId)!.name}]\n${n.text}`).join('\n\n');
      if (text.length > 2000) throw new AppError(409, 'Ghi chú công nợ cũ của các khách cần gộp vượt 2.000 ký tự. Rút gọn trước khi gộp để không mất nội dung.');
      const currentDebtNote = debtNotes.find(n => n.customerId === keepId);
      const values = { text, revision: (currentDebtNote?.revision ?? 0) + 1, updatedBy: actorId, updatedAt: new Date().toISOString() };
      await tx.insert(customerDebtNotes).values({ customerId: keepId, ...values }).onConflictDoUpdate({ target: customerDebtNotes.customerId, set: values });
    }

    // Chứng từ và lịch sử.
    await tx.update(salesOrders).set({ customerId: keepId }).where(inArray(salesOrders.customerId, ids));
    await tx.update(salesContracts).set({ customerId: keepId }).where(inArray(salesContracts.customerId, ids));
    await tx.update(customerPayments).set({ customerId: keepId }).where(inArray(customerPayments.customerId, ids));
    await tx.update(customerActivities).set({ customerId: keepId }).where(inArray(customerActivities.customerId, ids));
    // A merged customer stays once per campaign. Keep the strongest real outcome;
    // all care activities remain in the customer's history even when assignments collapse.
    const campaignTargets = await tx.select({ t: customerCampaignTargets, completion: customerActivities.completion })
      .from(customerCampaignTargets).leftJoin(customerActivities, eq(customerActivities.id, customerCampaignTargets.activityId))
      .where(inArray(customerCampaignTargets.customerId, [keepId, ...ids])).for('update', { of: customerCampaignTargets });
    const campaigns = new Set(campaignTargets.map(r => r.t.campaignId));
    const priority = (r: typeof campaignTargets[number]) => (r.completion === 'completed' ? 4 : 0) + (r.t.activityId ? 2 : 0) + (r.t.customerId === keepId ? 1 : 0);
    for (const id of campaigns) {
      const rows = campaignTargets.filter(r => r.t.campaignId === id).sort((a,b) => priority(b)-priority(a) || a.t.id.localeCompare(b.t.id));
      if (rows.length > 1) await tx.delete(customerCampaignTargets).where(inArray(customerCampaignTargets.id, rows.slice(1).map(r => r.t.id)));
      await tx.update(customerCampaignTargets).set({ customerId: keepId, revision: sql`${customerCampaignTargets.revision} + 1` }).where(eq(customerCampaignTargets.id, rows[0]!.t.id));
    }
    await tx.update(customerAccounts).set({ customerId: keepId }).where(inArray(customerAccounts.customerId, ids));
    await tx.update(customerStockRequests).set({ customerId: keepId }).where(inArray(customerStockRequests.customerId, ids));
    await tx.update(quoteOrderFollowups).set({ customerId: keepId }).where(inArray(quoteOrderFollowups.customerId, ids));
    await tx.update(quotations).set({ data: sql`jsonb_set(${quotations.data}::jsonb, '{customerId}', to_jsonb(${keepId}::text))::text` })
      .where(inArray(sql`(${quotations.data}::jsonb ->> 'customerId')`, ids));
    // Bảng việc CRM cũ (không còn dùng) — không import module crm, cập nhật trực tiếp.
    await tx.execute(sql`update crm_tasks set customer_id = ${keepId} where customer_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

    // Retain every source identity when multiple source rows resolve to the surviving customer.
    await tx.update(appsheetCustomerLinks).set({ customerId: keepId }).where(inArray(appsheetCustomerLinks.customerId, ids));
    await tx.delete(customers).where(inArray(customers.id, ids));
  });
  return ids.length;
}

export function registerCustomerDuplicateRoutes(router: Router<StaffEnv>) {
  /** Danh sách nhóm khách trùng MST (Manager). */
  router.get('/customer-duplicates', async c => {
    requireManager(c);
    const groups = await duplicateGroups(c.env.db);
    return json({ groups, total: groups.reduce((s, g) => s + g.customers.length - 1, 0) });
  }, 'business');
  /**
   * Gộp khách trùng MST (Manager). `{ keepId, dropIds }` gộp một nhóm theo lựa chọn;
   * `{ all: true }` gộp mọi nhóm, giữ bản có người liên hệ / nhiều chứng từ nhất (`pickKeeper`).
   */
  router.post('/customer-duplicates/merge', async c => {
    requireManager(c);
    const body = await readJson(c.req, 64_000);
    let merged = 0, groups = 0;
    if (body.all === true) {
      for (const g of await duplicateGroups(c.env.db)) { merged += await mergeCustomers(c.env.db, g.keepId, g.customers.filter(x => !x.keep).map(x => x.id), (c.state.session as SessionState).member.id); groups++; }
    } else {
      const keepId = typeof body.keepId === 'string' ? body.keepId : '';
      const dropIds = Array.isArray(body.dropIds) ? body.dropIds.filter((x): x is string => typeof x === 'string') : [];
      if (!keepId || !dropIds.length || dropIds.length > 50) throw new AppError(400, 'Chọn khách giữ lại và khách cần gộp.');
      merged = await mergeCustomers(c.env.db, keepId, dropIds, (c.state.session as SessionState).member.id); groups = 1;
    }
    return json({ ok: true, groups, merged });
  }, 'business');
}
