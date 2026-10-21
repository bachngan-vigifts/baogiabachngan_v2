import { departmentOwner } from '../../staff/api/department.ts';
import { customerInput } from '../domain/customer-input.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
import { and, asc, count, desc, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold, foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customerBrandDiscounts, customerContacts, customerNotes, customers, customerStaff } from '../schema.ts';
import { CUSTOMER_LIMITS, canListRetailCustomers } from '../domain/customer-config.ts';
import { NORM_TAX_SQL, normTaxCode } from '../domain/tax-code.ts';

type Ctx = RouteContext<StaffEnv>;
type Db = StaffEnv['db'];
type Viewer = { id: string; role: string; positionId?: string | null };
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();

/** Nhân viên phụ trách + được chia sẻ của nhiều khách (một lượt truy vấn). */
export async function customerStaffOf(db: Db, customerIds: string[]) {
  const out = new Map<string, { owner: { id: string; name: string } | null; shared: { id: string; name: string }[] }>();
  for (const id of customerIds) out.set(id, { owner: null, shared: [] });
  if (!customerIds.length) return out;
  const rows = await db.select({ customerId: customerStaff.customerId, role: customerStaff.role, id: employees.id, name: employees.name })
    .from(customerStaff).innerJoin(employees, eq(employees.id, customerStaff.memberId))
    .where(and(inArray(customerStaff.customerId, customerIds), isNull(employees.deletedAt))).orderBy(asc(employees.name));
  for (const r of rows) {
    const s = out.get(r.customerId)!;
    if (r.role === 'owner') s.owner = { id: r.id, name: r.name }; else s.shared.push({ id: r.id, name: r.name });
  }
  return out;
}

/**
 * Quyền của một người với một khách:
 *  - Manager, người phụ trách, người được chia sẻ: xem mọi báo giá / đơn / HĐKT / công nợ của khách (`canSeeAll`);
 *  - Manager: đổi người phụ trách; Manager hoặc người phụ trách: đổi danh sách người được chia sẻ.
 */
export async function customerAccess(db: Db, customerId: string, who: Viewer) {
  const [row] = await db.select({ role: customerStaff.role }).from(customerStaff)
    .where(and(eq(customerStaff.customerId, customerId), eq(customerStaff.memberId, who.id))).limit(1);
  const manager = who.role === 'manager', owner = row?.role === 'owner', shared = row?.role === 'shared';
  const [peer] = await db.select({ id: customerStaff.memberId }).from(customerStaff).where(and(eq(customerStaff.customerId, customerId), eq(customerStaff.role, 'owner'), departmentOwner(customerStaff.memberId, who) ?? sql`false`)).limit(1);
  return { manager, owner, shared, peer: !!peer, canSeeAll: manager || owner || shared || seesAllAsSaleAdmin(who), canManageStaff: manager || owner, canChangeOwner: manager, canEdit: manager || owner };
}
/** Sửa thông tin khách / người liên hệ: chỉ nhân viên phụ trách khách hoặc Manager. */
async function requireEdit(db: Db, customerId: string, who: Viewer) {
  if (!(await customerAccess(db, customerId, who)).canEdit) throw new AppError(403, 'Chỉ nhân viên phụ trách khách hàng hoặc Manager được sửa thông tin khách.');
}

/** Nhân viên / Manager đang hoạt động (người gán cho khách được). */
async function activeStaff(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return (await db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.id, ids), eq(employees.active, true), isNull(employees.deletedAt), inArray(employees.role, ['employee', 'manager'])))).map(r => r.id);
}

/** Khách khác đã dùng MST này (chống trùng khách theo mã số thuế). */
export async function customerWithTaxCode(db: Db, taxCode: string, exceptId?: string) {
  const tax = normTaxCode(taxCode); if (!tax) return null;
  const [row] = await db.select({ id: customers.id, name: customers.name }).from(customers)
    .where(and(sql`${sql.raw(NORM_TAX_SQL('tax_code'))} = ${tax}`, exceptId ? ne(customers.id, exceptId) : undefined)).limit(1);
  return row ?? null;
}

async function loadCustomer(db: Db, id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy khách hàng.');
  return row;
}

/** Chiết khấu theo thương hiệu (%) của khách – áp dụng khi thêm sản phẩm vào báo giá. Chưa đặt = null. */
export const BRAND_DISCOUNT_KEYS = ['minhLong', 'lys', 'lock'] as const;
export type BrandDiscounts = Record<typeof BRAND_DISCOUNT_KEYS[number], number | null>;
export async function brandDiscountsOf(db: Db, customerId: string): Promise<BrandDiscounts> {
  const rows = await db.select({ key: customerBrandDiscounts.brandKey, percent: customerBrandDiscounts.percent }).from(customerBrandDiscounts)
    .where(eq(customerBrandDiscounts.customerId, customerId));
  return Object.fromEntries(BRAND_DISCOUNT_KEYS.map(k => [k, rows.find(r => r.key === k)?.percent ?? null])) as BrandDiscounts;
}

/** Hồ sơ khách: thông tin, người phụ trách, người được chia sẻ, người liên hệ, chiết khấu thương hiệu, quyền của người xem. */
export async function customerProfile(db: Db, id: string, who: Viewer) {
  const [customer, staff, contacts, access, discounts] = await Promise.all([
    loadCustomer(db, id),
    customerStaffOf(db, [id]),
    db.select({ id: customerContacts.id, name: customerContacts.name, title: customerContacts.title, phone: customerContacts.phone, email: customerContacts.email,
      note: customerContacts.note, isPrimary: customerContacts.isPrimary, updatedAt: customerContacts.updatedAt })
      .from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(desc(customerContacts.isPrimary), asc(customerContacts.createdAt)),
    customerAccess(db, id, who),
    brandDiscountsOf(db, id),
  ]);
  const { search: _s, sourceVersion: _v, ...info } = customer;
  return { customer: { ...info, fromSapo: /^\d+$/.test(customer.id) }, ...staff.get(id)!, contacts, discounts, access, generalNote: await generalNoteOf(db, id, access) };
}

/** Internal notes follow customer visibility; never returned to the customer portal. */
async function generalNoteOf(db: Db, id: string, access: Awaited<ReturnType<typeof customerAccess>>) {
  if (!access.canSeeAll && !access.peer) return null;
  const [note] = await db.select({ text: customerNotes.text, revision: customerNotes.revision, updatedAt: customerNotes.updatedAt,
    updatedBy: employees.name }).from(customerNotes).innerJoin(employees, eq(employees.id, customerNotes.updatedBy))
    .where(eq(customerNotes.customerId, id)).limit(1);
  return note ?? { text: '', revision: 0, updatedAt: null, updatedBy: null };
}

export function registerCustomerRoutes(router: Router<StaffEnv>) {
  router.get('/customers/:id/notes', async c => {
    const db = c.env.db, id = c.params.id!, me = viewer(c);
    await loadCustomer(db, id);
    const note = await generalNoteOf(db, id, await customerAccess(db, id, me));
    if (!note) throw new AppError(403, 'Bạn không có quyền xem ghi chú của khách này.');
    return json(note);
  }, 'business');
  router.put('/customers/:id/notes', async c => {
    const db = c.env.db, id = c.params.id!, me = viewer(c);
    await loadCustomer(db, id); await requireEdit(db, id, me);
    const body = await readJson(c.req, 32_768);
    if (typeof body.text !== 'string' || body.text.length > 5000 || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
      throw new AppError(400, 'Ghi chú tối đa 5.000 ký tự và cần phiên bản hợp lệ.');
    const revision = Number(body.revision), now = nowIso();
    const values = { text: body.text.trim(), revision: revision + 1, updatedAt: now, updatedBy: me.id };
    const changed = revision === 0
      ? await db.insert(customerNotes).values({ customerId: id, ...values }).onConflictDoNothing().returning({ id: customerNotes.customerId })
      : await db.update(customerNotes).set(values).where(and(eq(customerNotes.customerId, id), eq(customerNotes.revision, revision))).returning({ id: customerNotes.customerId });
    if (!changed.length) throw new AppError(409, 'Ghi chú đã được người khác cập nhật. Tải lại ghi chú trước khi lưu.', 'CUSTOMER_NOTE_CONFLICT');
    return json({ ...values, updatedBy: me.name });
  }, 'business');

  // Tìm không dấu theo tên, người liên hệ, điện thoại, email, MST, mã KH; phân trang (?q=&limit=&offset=).
  // `?mine=1`: chỉ khách mình phụ trách hoặc được chia sẻ. Mỗi dòng kèm người phụ trách.
  // Thứ tự: khách mới tạo lên trên cùng (created_at giảm dần; dữ liệu cũ không có ngày tạo xuống cuối), cùng ngày thì theo tên.
  router.get('/customers', async c => {
    const { limit, offset } = paging(c.url, 100, 500), me = viewer(c);
    const mine = c.url.searchParams.get('mine') === '1'
      ? exists(c.env.db.select({ x: sql`1` }).from(customerStaff).where(and(eq(customerStaff.customerId, customers.id), or(eq(customerStaff.memberId, me.id), departmentOwner(customerStaff.memberId, me)))))
      : undefined;
    // `?status=pending`: khách chờ Manager duyệt; `?usable=1`: chỉ khách đã duyệt (chọn cho báo giá / đơn).
    const status = c.url.searchParams.get('status'), usable = c.url.searchParams.get('usable') === '1';
    const approval = status === 'pending' || status === 'approved' ? eq(customers.approvalStatus, status) : usable ? eq(customers.approvalStatus, 'approved') : undefined;
    const retailVisible = canListRetailCustomers(me), kind = c.url.searchParams.get('kind');
    const segment = !retailVisible ? eq(customers.isRetail, false) : kind === 'retail' ? eq(customers.isRetail, true) : kind === 'business' ? eq(customers.isRetail, false) : undefined;
    const where = and(segment, matchAllWords(foldSql(customers.name, customers.contact, customers.phone, customers.email, customers.taxCode, customers.customerCode), c.url.searchParams.get('q')), mine, approval);
    const [[{ total = 0 } = {}], rows, [{ pending = 0 } = {}]] = await Promise.all([
      c.env.db.select({ total: count() }).from(customers).where(where),
      c.env.db.select().from(customers).where(where).orderBy(desc(customers.createdAt), asc(foldSql(customers.name)), asc(customers.name), asc(customers.id)).limit(limit).offset(offset),
      c.env.db.select({ pending: count() }).from(customers).where(and(eq(customers.approvalStatus, 'pending'), segment)),
    ]);
    const staff = await customerStaffOf(c.env.db, rows.map(r => r.id));
    return json({ customers: rows.map(r => ({ ...r, owner: staff.get(r.id)!.owner, sharedCount: staff.get(r.id)!.shared.length })),
      canListRetail: retailVisible, total: Number(total), pendingCount: Number(pending), limit, offset, nextOffset: offset + rows.length < Number(total) ? offset + rows.length : null });
  }, 'business');

  const save = async (c: Ctx, update: boolean) => {
    const body = await readJson(c.req, 16_384), me = viewer(c);
    const now = nowIso(), id = update ? c.params.id! : crypto.randomUUID();
    const {fields,terms}=customerInput(body);
    const row = { ...fields, ...terms, search: fold(Object.values(fields).join(' ')), sourceVersion: 0, syncedAt: now };
    // Sửa khách mà không đổi MST thì không chặn (dữ liệu trùng cũ gộp bằng chức năng "Gộp khách trùng MST").
    const unchanged = update && normTaxCode((await loadCustomer(c.env.db, id)).taxCode) === normTaxCode(fields.taxCode);
    const dup = unchanged ? null : await customerWithTaxCode(c.env.db, fields.taxCode, update ? id : undefined);
    if (dup) throw new AppError(409, `Mã số thuế ${fields.taxCode} đã có ở khách "${dup.name}". Mở khách đó thay vì tạo trùng.`, 'CUSTOMER_TAX_DUPLICATE');
    if (update) {
      await loadCustomer(c.env.db, id); await requireEdit(c.env.db, id, me);
      if (!(await c.env.db.update(customers).set(row).where(eq(customers.id, id)).returning({ id: customers.id })).length) throw new AppError(404, 'Không tìm thấy khách hàng.');
      return json({ id });
    }
    // Khách mới: người tạo là người phụ trách (Manager chọn được người khác qua `ownerId`).
    const wanted = me.role === 'manager' && typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : me.id;
    const [ownerId] = await activeStaff(c.env.db, [wanted]);
    // Khách nhân viên tạo chờ Manager duyệt mới dùng được cho báo giá / đơn; Manager tạo thì có hiệu lực ngay.
    const mgr = me.role === 'manager';
    await c.env.db.transaction(async tx => {
      await tx.insert(customers).values({ id, createdAt: now, ...row, approvalStatus: mgr ? 'approved' : 'pending', createdBy: me.id, approvedBy: mgr ? me.id : null, approvedAt: mgr ? now : null });
      if (ownerId) await tx.insert(customerStaff).values({ customerId: id, memberId: ownerId, role: 'owner', createdBy: me.id, createdAt: now });
    });
    return json({ id, approvalStatus: mgr ? 'approved' : 'pending' }, 201);
  };
  router.post('/customers', c => save(c, false), 'business');
  router.put('/customers/:id', c => save(c, true), 'business');

  /** Duyệt khách mới: Manager hoặc nhân viên được Manager bật cờ "Được duyệt". */
  router.post('/customers/:id/approve', async c => {
    const me = viewer(c);
    if (!canApprove(me)) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt khách hàng mới.', 'APPROVER_ONLY');
    const now = nowIso();
    const done = await c.env.db.update(customers).set({ approvalStatus: 'approved', approvedBy: me.id, approvedAt: now })
      .where(and(eq(customers.id, c.params.id!), eq(customers.approvalStatus, 'pending'))).returning({ id: customers.id });
    if (!done.length) throw new AppError(404, 'Không tìm thấy khách hàng đang chờ duyệt.');
    return json({ ok: true });
  }, 'business');
  /** Từ chối (xoá) khách đang chờ duyệt: Manager / người được duyệt, hoặc người tạo. Khách đã duyệt không xoá được ở đây. */
  router.delete('/customers/:id', async c => {
    const me = viewer(c), db = c.env.db;
    const [row] = await db.select({ approvalStatus: customers.approvalStatus, createdBy: customers.createdBy }).from(customers).where(eq(customers.id, c.params.id!)).limit(1);
    if (!row || row.approvalStatus !== 'pending') throw new AppError(404, 'Chỉ xoá được khách hàng đang chờ duyệt.');
    if (!canApprove(me) && row.createdBy !== me.id) throw new AppError(403, 'Chỉ Manager, người được duyệt hoặc người tạo xoá được khách hàng này.');
    await db.delete(customers).where(and(eq(customers.id, c.params.id!), eq(customers.approvalStatus, 'pending')));
    return json({ ok: true });
  }, 'business');

  router.get('/customers/:id', async c => json(await customerProfile(c.env.db, c.params.id!, viewer(c))), 'business');

  /**
   * Đổi người phụ trách (`ownerId`, chỉ Manager; `null` = bỏ trống) và/hoặc danh sách người được chia sẻ
   * (`sharedIds`, Manager hoặc người phụ trách). Danh sách gửi lên thay toàn bộ danh sách cũ.
   */
  router.put('/customers/:id/staff', async c => {
    const db = c.env.db, me = viewer(c), id = c.params.id!, body = await readJson(c.req, 8_000);
    await loadCustomer(db, id);
    const access = await customerAccess(db, id, me), now = nowIso();
    const changeOwner = body.ownerId !== undefined, changeShared = body.sharedIds !== undefined;
    if (changeOwner && !access.canChangeOwner) throw new AppError(403, 'Chỉ Manager đổi được nhân viên phụ trách.');
    if (changeShared && !access.canManageStaff) throw new AppError(403, 'Chỉ Manager hoặc nhân viên phụ trách chia sẻ được khách hàng.');
    let ownerId: string | null | undefined;
    if (changeOwner) {
      if (body.ownerId === null || body.ownerId === '') ownerId = null;
      else if (typeof body.ownerId !== 'string' || !(ownerId = (await activeStaff(db, [body.ownerId]))[0])) throw new AppError(400, 'Nhân viên phụ trách không hợp lệ.');
    }
    let sharedIds: string[] | undefined;
    if (changeShared) {
      if (!Array.isArray(body.sharedIds) || body.sharedIds.some(x => typeof x !== 'string')) throw new AppError(400, 'Danh sách chia sẻ không hợp lệ.');
      const wanted = [...new Set(body.sharedIds as string[])];
      if (wanted.length > CUSTOMER_LIMITS.shared) throw new AppError(400, `Chia sẻ tối đa ${CUSTOMER_LIMITS.shared} nhân viên.`);
      sharedIds = await activeStaff(db, wanted);
      if (sharedIds.length !== wanted.length) throw new AppError(400, 'Có nhân viên không hợp lệ trong danh sách chia sẻ.');
    }
    await db.transaction(async tx => {
      if (ownerId !== undefined) {
        await tx.delete(customerStaff).where(and(eq(customerStaff.customerId, id), eq(customerStaff.role, 'owner')));
        if (ownerId) {
          await tx.delete(customerStaff).where(and(eq(customerStaff.customerId, id), eq(customerStaff.memberId, ownerId)));
          await tx.insert(customerStaff).values({ customerId: id, memberId: ownerId, role: 'owner', createdBy: me.id, createdAt: now });
        }
      }
      if (sharedIds) {
        const [owner] = await tx.select({ id: customerStaff.memberId }).from(customerStaff).where(and(eq(customerStaff.customerId, id), eq(customerStaff.role, 'owner'))).limit(1);
        await tx.delete(customerStaff).where(and(eq(customerStaff.customerId, id), eq(customerStaff.role, 'shared')));
        const rows = sharedIds.filter(x => x !== owner?.id).map(memberId => ({ customerId: id, memberId, role: 'shared' as const, createdBy: me.id, createdAt: now }));
        if (rows.length) await tx.insert(customerStaff).values(rows);
      }
    });
    return json(await customerProfile(db, id, me));
  }, 'business');

  // ----- Người liên hệ
  const contactFields = (body: Record<string, unknown>) => {
    const t = (k: string, max: number) => { const v = body[k] ?? ''; if (typeof v !== 'string' || v.length > max) throw new AppError(400, 'Thông tin người liên hệ không hợp lệ.'); return v.trim(); };
    const name = t('name', CUSTOMER_LIMITS.contactName);
    if (!name) throw new AppError(400, 'Nhập tên người liên hệ.');
    const email = t('email', 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Email người liên hệ không hợp lệ.');
    return { name, title: t('title', CUSTOMER_LIMITS.contactTitle), phone: t('phone', 40), email, note: t('note', CUSTOMER_LIMITS.contactNote), isPrimary: body.isPrimary === true };
  };
  /** Chiết khấu thương hiệu của khách (để báo giá điền sẵn CK khi thêm sản phẩm). */
  router.get('/customers/:id/discounts', async c => {
    await loadCustomer(c.env.db, c.params.id!);
    return json({ discounts: await brandDiscountsOf(c.env.db, c.params.id!) });
  }, 'business');
  /** Sửa chiết khấu thương hiệu (%): `{ minhLong, lys, lock }`, mỗi ô 0–100 hoặc trống (= chưa thiết lập). Người phụ trách / Manager. */
  router.put('/customers/:id/discounts', async c => {
    const db = c.env.db, id = c.params.id!, body = await readJson(c.req, 2_000);
    await loadCustomer(db, id); await requireEdit(db, id, viewer(c));
    const values = BRAND_DISCOUNT_KEYS.map(k => {
      const v = body[k];
      if (v === undefined) return [k, undefined] as const;
      if (v === null || v === '') return [k, null] as const;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError(400, 'Chiết khấu phải từ 0 đến 100%.');
      return [k, Math.round(n * 100) / 100] as const;
    });
    await db.transaction(async tx => {
      for (const [k, v] of values) {
        if (v === undefined) continue;
        await tx.delete(customerBrandDiscounts).where(and(eq(customerBrandDiscounts.customerId, id), eq(customerBrandDiscounts.brandKey, k)));
        if (v !== null) await tx.insert(customerBrandDiscounts).values({ customerId: id, brandKey: k, percent: v });
      }
    });
    return json({ discounts: await brandDiscountsOf(db, id) });
  }, 'business');
  router.post('/customers/:id/contacts', async c => {
    const db = c.env.db, id = c.params.id!, f = contactFields(await readJson(c.req, 8_000)), now = nowIso();
    await loadCustomer(db, id); await requireEdit(db, id, viewer(c));
    const [{ n = 0 } = {}] = await db.select({ n: count() }).from(customerContacts).where(eq(customerContacts.customerId, id));
    if (Number(n) >= CUSTOMER_LIMITS.contacts) throw new AppError(400, `Mỗi khách tối đa ${CUSTOMER_LIMITS.contacts} người liên hệ.`);
    const contactId = crypto.randomUUID();
    await db.transaction(async tx => {
      if (f.isPrimary) await tx.update(customerContacts).set({ isPrimary: false }).where(eq(customerContacts.customerId, id));
      await tx.insert(customerContacts).values({ id: contactId, customerId: id, ...f, createdBy: viewer(c).id, createdAt: now, updatedAt: now });
    });
    return json({ id: contactId }, 201);
  }, 'business');
  router.put('/customers/:id/contacts/:contactId', async c => {
    const db = c.env.db, id = c.params.id!, f = contactFields(await readJson(c.req, 8_000));
    await loadCustomer(db, id); await requireEdit(db, id, viewer(c));
    const done = await db.transaction(async tx => {
      if (f.isPrimary) await tx.update(customerContacts).set({ isPrimary: false }).where(and(eq(customerContacts.customerId, id), ne(customerContacts.id, c.params.contactId!)));
      return tx.update(customerContacts).set({ ...f, updatedAt: nowIso() })
        .where(and(eq(customerContacts.id, c.params.contactId!), eq(customerContacts.customerId, id))).returning({ id: customerContacts.id });
    });
    if (!done.length) throw new AppError(404, 'Không tìm thấy người liên hệ.');
    return json({ ok: true });
  }, 'business');
  router.delete('/customers/:id/contacts/:contactId', async c => {
    await loadCustomer(c.env.db, c.params.id!); await requireEdit(c.env.db, c.params.id!, viewer(c));
    const done = await c.env.db.delete(customerContacts)
      .where(and(eq(customerContacts.id, c.params.contactId!), eq(customerContacts.customerId, c.params.id!))).returning({ id: customerContacts.id });
    if (!done.length) throw new AppError(404, 'Không tìm thấy người liên hệ.');
    return json({ ok: true });
  }, 'business');
}

