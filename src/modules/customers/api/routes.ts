import {customerProvince,provinceOptions} from '../domain/province.ts';
import {provinceCodeSql} from './province.ts';
import {registerProvinceSharing} from './province-sharing.ts';
import {contactDirectoryVersion,editableContacts,saveContactDirectory,lockContactCustomer,ensureLegacyContact,syncPrimaryContact} from './contact-directory.ts';
import { anniversarySuggestion, vietnamToday, ANNIVERSARY_LEAD_DAYS, ANNIVERSARY_INTERVAL } from '../domain/anniversary.ts';
import { customerIdentityLock, findCustomerDuplicates, rejectDuplicate } from './identity.ts';
import { changedIdentity } from '../domain/identity.ts';
import { customerContactInput, initialCustomerProfile } from '../domain/customer-contact-input.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { customerInput } from '../domain/customer-input.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
import { and, asc, count, desc, eq, exists, inArray, isNull, ne, not, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold, foldSql, matchAllWords, paging, rankFirst, searchRank } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customerBrandDiscounts, customerContacts, customerDebtNotes, customerNotes, customers, customerStaff } from '../schema.ts';
import { CUSTOMER_LIMITS, canListRetailCustomers } from '../domain/customer-config.ts';

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
 *  - Manager, người phụ trách, người được chia sẻ: sửa hồ sơ / danh bạ (`canEditProfile`).
 *  - Manager: đổi người phụ trách; Manager hoặc người phụ trách: đổi danh sách người được chia sẻ.
 */
export async function customerAccess(db: Db, customerId: string, who: Viewer) {
  const [row] = await db.select({ role: customerStaff.role }).from(customerStaff)
    .where(and(eq(customerStaff.customerId, customerId), eq(customerStaff.memberId, who.id))).limit(1);
  const manager = who.role === 'manager', owner = row?.role === 'owner', shared = row?.role === 'shared';
  const [peer] = await db.select({ id: customerStaff.memberId }).from(customerStaff).where(and(eq(customerStaff.customerId, customerId), eq(customerStaff.role, 'owner'), departmentOwner(customerStaff.memberId, who) ?? sql`false`)).limit(1);
  return { manager, owner, shared, peer: !!peer, canSeeAll: manager || owner || shared || seesAllAsSaleAdmin(who), canManageStaff: manager || owner, canChangeOwner: manager, canEdit: manager || owner, canEditProfile: manager || owner || shared };
}
/** Ghi chú và chiết khấu riêng vẫn chỉ cho nhân viên phụ trách khách hoặc Manager. */
async function requireEdit(db: Db, customerId: string, who: Viewer) {
  if (!(await customerAccess(db, customerId, who)).canEdit) throw new AppError(403, 'Chỉ nhân viên phụ trách khách hàng hoặc Manager được chỉnh sửa mục này.');
}
/** Editing the customer form and its contacts does not grant staff-management or approval privileges. */
async function requireProfileEdit(db: Db, customerId: string, who: Viewer) {
  if (!(await customerAccess(db, customerId, who)).canEditProfile) throw new AppError(403, 'Chỉ Manager, nhân viên phụ trách hoặc nhân viên được chia sẻ khách hàng được cập nhật hồ sơ khách.');
}

/** Nhân viên / Manager đang hoạt động (người gán cho khách được). */
async function activeStaff(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return (await db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.id, ids), eq(employees.active, true), isNull(employees.deletedAt), inArray(employees.role, ['employee', 'manager'])))).map(r => r.id);
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
  const [rejecter] = info.rejectedBy ? await db.select({ name: employees.name }).from(employees).where(eq(employees.id, info.rejectedBy)).limit(1) : [];
  return { customer: { ...info, province:customerProvince(customer.address), rejectedByName: rejecter?.name ?? null, anniversary: anniversarySuggestion(customer.establishedDate), fromSapo: /^\d+$/.test(customer.id) }, ...staff.get(id)!, contacts, contactDirectory:editableContacts(customer,contacts),contactDirectoryVersion:contactDirectoryVersion(customer,contacts), discounts, access,
    generalNote: await generalNoteOf(db, id, access), debtNote: await debtNoteOf(db, id, access) };
}

/** Ghi chú công nợ cũ nhạy cảm hơn ghi chú chung: chỉ người xem được toàn bộ khách (`canSeeAll`) đọc được, nhân viên cùng phòng ban thì không. */
async function debtNoteOf(db: Db, id: string, access: Awaited<ReturnType<typeof customerAccess>>) {
  if (!access.canSeeAll) return null;
  const [note] = await db.select({ text: customerDebtNotes.text, revision: customerDebtNotes.revision, updatedAt: customerDebtNotes.updatedAt,
    updatedBy: employees.name }).from(customerDebtNotes).innerJoin(employees, eq(employees.id, customerDebtNotes.updatedBy))
    .where(eq(customerDebtNotes.customerId, id)).limit(1);
  return note ?? { text: '', revision: 0, updatedAt: null, updatedBy: null };
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
  registerProvinceSharing(router);
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
    if (!changed.length) {
      const [current]=await db.select().from(customerNotes).where(eq(customerNotes.customerId,id)).limit(1);
      // Desired state matches one immediate write by this user; this is not a general command receipt.
      if(current&&current.revision===revision+1&&current.updatedBy===me.id&&current.text===values.text)return json({text:current.text,revision:current.revision,updatedAt:current.updatedAt,updatedBy:me.name,stateMatches:true});
      throw new AppError(409, 'Ghi chú đã được cập nhật. Tải lại ghi chú trước khi lưu.', 'CUSTOMER_NOTE_CONFLICT');
    }
    return json({ ...values, updatedBy: me.name });
  }, 'business');

  /** Chọn / bỏ người đại diện của khách: phải là một người trong danh bạ liên hệ của chính khách (`contactId: null` = bỏ chọn). */
  router.put('/customers/:id/representative', async c => {
    const db=c.env.db,id=c.params.id!,me=viewer(c),wanted=(await readJson(c.req,1_024)).contactId;
    if(wanted!==null&&(typeof wanted!=='string'||!wanted||wanted.length>200))throw new AppError(400,'Người đại diện không hợp lệ.');
    await db.transaction(async tx=>{
      await lockContactCustomer(tx as any,id);await requireProfileEdit(tx as any,id,me);
      if(wanted){
        const [contact]=await tx.select({id:customerContacts.id}).from(customerContacts).where(and(eq(customerContacts.id,wanted),eq(customerContacts.customerId,id))).limit(1);
        if(!contact)throw new AppError(400,'Người đại diện phải là người trong danh bạ liên hệ của khách này.');
      }
      await tx.update(customers).set({representativeContactId:wanted}).where(eq(customers.id,id));
    });return json({representativeContactId:wanted});
  },'business');
  router.get('/customers/:id/debt-note', async c => {
    const db = c.env.db, id = c.params.id!;
    await loadCustomer(db, id);
    const note = await debtNoteOf(db, id, await customerAccess(db, id, viewer(c)));
    if (!note) throw new AppError(403, 'Bạn không có quyền xem ghi chú công nợ cũ của khách này.');
    return json(note);
  }, 'business');
  router.put('/customers/:id/debt-note', async c => {
    const db = c.env.db, id = c.params.id!, me = viewer(c);
    await loadCustomer(db, id); await requireEdit(db, id, me);
    const body = await readJson(c.req, 16_384);
    if (typeof body.text !== 'string' || body.text.length > 2000 || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
      throw new AppError(400, 'Ghi chú công nợ cũ tối đa 2.000 ký tự và cần phiên bản hợp lệ.');
    const revision = Number(body.revision), now = nowIso();
    const values = { text: body.text.trim(), revision: revision + 1, updatedAt: now, updatedBy: me.id };
    const changed = revision === 0
      ? await db.insert(customerDebtNotes).values({ customerId: id, ...values }).onConflictDoNothing().returning({ id: customerDebtNotes.customerId })
      : await db.update(customerDebtNotes).set(values).where(and(eq(customerDebtNotes.customerId, id), eq(customerDebtNotes.revision, revision))).returning({ id: customerDebtNotes.customerId });
    if (!changed.length) throw new AppError(409, 'Ghi chú công nợ cũ đã được cập nhật. Tải lại trước khi lưu.', 'CUSTOMER_DEBT_NOTE_CONFLICT');
    return json({ ...values, updatedBy: me.name });
  }, 'business');

  // Tìm không dấu theo tên, người liên hệ, điện thoại, email, MST, mã KH; phân trang (?q=&limit=&offset=).
  // `?mine=1`: chỉ khách mình phụ trách hoặc được chia sẻ. Mỗi dòng kèm người phụ trách.
  // Thứ tự: có từ khoá thì khớp nhất lên trước (searchRank); còn lại khách mới tạo lên trên cùng (created_at giảm dần; dữ liệu cũ không có ngày tạo xuống cuối), cùng ngày thì theo tên.
  router.get('/customers', async c => {
    const { limit, offset } = paging(c.url, 100, 500), me = viewer(c);
    const province=c.url.searchParams.get('province')||'';
    if(province&&province!=='unknown'&&!provinceOptions.some(p=>p.code===province))throw new AppError(400,'Tỉnh/thành không hợp lệ.');
    const provinceFilter=province==='unknown'?isNull(provinceCodeSql(customers.address)):province?eq(provinceCodeSql(customers.address),province):undefined;
    const mine = c.url.searchParams.get('mine') === '1'
      ? exists(c.env.db.select({ x: sql`1` }).from(customerStaff).where(and(eq(customerStaff.customerId, customers.id), or(eq(customerStaff.memberId, me.id), departmentOwner(customerStaff.memberId, me)))))
      : undefined;
    // `?status=pending`: khách chờ Manager duyệt; `?usable=1`: chỉ khách đã duyệt (chọn cho báo giá / đơn);
    // `?status=rejected`: khách bị từ chối (người duyệt xem hết, người khác chỉ thấy khách mình tạo). Danh sách mặc định ẩn khách bị từ chối.
    const status = c.url.searchParams.get('status'), usable = c.url.searchParams.get('usable') === '1';
    const approval = status === 'rejected' ? and(eq(customers.approvalStatus, 'rejected'), canApprove(me) ? undefined : eq(customers.createdBy, me.id))
      : status === 'pending' || status === 'approved' ? eq(customers.approvalStatus, status) : usable ? eq(customers.approvalStatus, 'approved') : ne(customers.approvalStatus, 'rejected');
    const retailVisible = canListRetailCustomers(me), kind = c.url.searchParams.get('kind');
    const segment = !retailVisible ? eq(customers.isRetail, false) : kind === 'retail' ? eq(customers.isRetail, true) : kind === 'business' ? eq(customers.isRetail, false) : undefined;
    const owner = c.url.searchParams.get('owner') || '', from = c.url.searchParams.get('from') || '', to = c.url.searchParams.get('to') || '';
    // Ô chọn khách (lập báo giá / đơn): `usable=1&limit≤8&q=…` chỉ cần vài khách khớp nhất. Một truy vấn trên cột `search`
    // (đã bỏ dấu sẵn khi lưu) thay cho bỏ dấu 6 cột từng dòng + đếm tổng + đếm khách chờ duyệt + người phụ trách.
    const q = c.url.searchParams.get('q') || '';
    if (usable && !province && !status && limit <= 8 && offset === 0 && q.trim() && !mine && !owner && !from && !to && !kind && c.url.searchParams.get('filters') !== '1') {
      const rows = await c.env.db.select().from(customers)
        .where(and(segment, eq(customers.approvalStatus, 'approved'), matchAllWords(sql`${customers.search}`, q)))
        .orderBy(...rankFirst(searchRank([customers.customerCode, customers.phone, customers.taxCode], customers.name, q)), desc(customers.createdAt), asc(customers.name), asc(customers.id)).limit(limit);
      return json({ customers: rows.map(({ search: _s, sourceVersion: _v, ...r }) => r), picker: true, limit, offset: 0, nextOffset: null });
    }
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng ngày tạo không hợp lệ.');
    const hasOwner = (id?: string) => exists(c.env.db.select({ x: sql`1` }).from(customerStaff).innerJoin(employees, eq(employees.id, customerStaff.memberId))
      .where(and(eq(customerStaff.customerId, customers.id), eq(customerStaff.role, 'owner'), isNull(employees.deletedAt), id ? eq(customerStaff.memberId, id) : undefined)));
    const assigned = owner === 'unassigned' ? not(hasOwner()) : owner ? hasOwner(owner) : undefined;
    // ISO UTC timestamps: use Vietnam midnight boundaries; imported undated customers remain visible without a date filter.
    const start = from ? new Date(from + 'T00:00:00+07:00').toISOString() : '', end = to ? new Date(Date.parse(to + 'T00:00:00+07:00') + 86400000).toISOString() : '';
    const created = start || end ? and(ne(customers.createdAt, ''), start ? sql`${customers.createdAt} >= ${start}` : undefined, end ? sql`${customers.createdAt} < ${end}` : undefined) : undefined;
    const sort = c.url.searchParams.get('sort') || 'newest';
    if (!['newest','oldest','name-asc','name-desc'].includes(sort)) throw new AppError(400, 'Cách sắp xếp khách hàng không hợp lệ.');
    const order = sort === 'oldest' ? [asc(customers.createdAt)] : sort === 'name-asc' ? [asc(foldSql(customers.name)), asc(customers.name)] : sort === 'name-desc' ? [desc(foldSql(customers.name)), desc(customers.name)] : [desc(customers.createdAt)];
    const where = and(segment, matchAllWords(foldSql(customers.name, customers.contact, customers.phone, customers.email, customers.taxCode, customers.customerCode), c.url.searchParams.get('q')), mine, approval, assigned, created,provinceFilter);
    const [[{ total = 0 } = {}], rows, [{ pending = 0 } = {}], owners] = await Promise.all([
      c.env.db.select({ total: count() }).from(customers).where(where),
      c.env.db.select().from(customers).where(where).orderBy(...rankFirst(searchRank([customers.customerCode, customers.phone, customers.taxCode], customers.name, c.url.searchParams.get('q'))), ...order, asc(foldSql(customers.name)), asc(customers.name), asc(customers.id)).limit(limit).offset(offset),
      c.env.db.select({ pending: count() }).from(customers).where(and(eq(customers.approvalStatus, 'pending'), segment)),
      c.url.searchParams.get('filters') === '1' ? c.env.db.selectDistinct({id:employees.id,name:employees.name}).from(customerStaff)
        .innerJoin(employees,eq(employees.id,customerStaff.memberId)).innerJoin(customers,eq(customers.id,customerStaff.customerId))
        .where(and(segment,eq(customerStaff.role,'owner'),isNull(employees.deletedAt))).orderBy(asc(employees.name),asc(employees.id)) : Promise.resolve(undefined),
    ]);
    const staff = await customerStaffOf(c.env.db, rows.map(r => r.id));
    return json({ customers: rows.map(r => ({ ...r, province:customerProvince(r.address), anniversary: anniversarySuggestion(r.establishedDate), owner: staff.get(r.id)!.owner, sharedCount: staff.get(r.id)!.shared.length })),
      filterOptions: owners ? {owners,provinces:provinceOptions} : undefined, canListRetail: retailVisible, total: Number(total), pendingCount: Number(pending), limit, offset, nextOffset: offset + rows.length < Number(total) ? offset + rows.length : null });
  }, 'business');

  // Reminder scope is restricted to the viewer's owned/shared/department customers; managers see all.
  router.get('/customers/anniversaries', async c => {
    const me = viewer(c), today = vietnamToday(), db = c.env.db;
    const scope = me.role === 'manager' || seesAllAsSaleAdmin(me) ? undefined : exists(db.select({ id: customerStaff.customerId }).from(customerStaff)
      .where(and(eq(customerStaff.customerId, customers.id), or(eq(customerStaff.memberId, me.id), departmentOwner(customerStaff.memberId, me)))));
    const rows = await db.select({ id: customers.id, name: customers.name, contact: customers.contact, phone: customers.phone, establishedDate: customers.establishedDate })
      .from(customers).where(and(eq(customers.isRetail, false), eq(customers.approvalStatus, 'approved'), sql`${customers.establishedDate} is not null`, scope));
    const reminders = rows.map(row => ({ ...row, anniversary: anniversarySuggestion(row.establishedDate, today) }))
      .filter((row): row is typeof row & { anniversary: NonNullable<typeof row.anniversary> } => !!row.anniversary?.upcoming)
      .sort((a, b) => a.anniversary.date.localeCompare(b.anniversary.date) || a.id.localeCompare(b.id));
    return json({ today, leadDays: ANNIVERSARY_LEAD_DAYS, intervalYears: ANNIVERSARY_INTERVAL, total: reminders.length, reminders: reminders.slice(0, 100) });
  }, 'business');

  router.get('/customers/duplicates/check', async c => {
    const p = c.url.searchParams;
    const matches = await findCustomerDuplicates(c.env.db, { name: (p.get('name') || '').slice(0,500), phone: (p.get('phone') || '').slice(0,40), taxCode: (p.get('taxCode') || '').slice(0,500) }, p.get('exceptId') || undefined);
    return json({ matches: matches.map(m => ({ id: m.isRetail && !canListRetailCustomers(viewer(c)) ? null : m.id,
      name: m.isRetail && !canListRetailCustomers(viewer(c)) ? 'Khách hàng trong danh mục hạn chế' : m.name, reasons: m.reasons })) });
  }, 'business');

  const save = async (c: Ctx, update: boolean) => {
    const body = await readJson(c.req, 512_000), me = viewer(c);
    const now = nowIso(), id = update ? c.params.id! : crypto.randomUUID();
    const initial = update ? null : initialCustomerProfile(body);
    const primary = initial?.contacts.find(row => row.isPrimary);
    const {fields,terms}=customerInput(primary && !body.contact ? {...body,contact:primary.name} : body,false,{requireProfile:!update});
    if (primary) {
      if (fields.contact && fields.contact !== primary.name) throw new AppError(400, 'Tên liên hệ chính chưa khớp với người được chọn trong danh bạ.');
      fields.contact = primary.name;
    }
    if (update) await requireProfileEdit(c.env.db, id, me);
    // Người đại diện: khi tạo mới dùng `isRepresentative` trong `contacts`; khi sửa dùng PUT /customers/:id/representative
    // (không đi qua đây vì PUT này ghi đè mọi ô thông tin bằng giá trị gửi lên).
    const row = { ...fields, ...terms, search: fold(Object.values(fields).join(' ')), sourceVersion: 0, syncedAt: now };
    // Khách mới: người tạo là người phụ trách (Manager chọn được người khác qua `ownerId`).
    if (!update && me.role !== 'manager' && body.ownerId !== undefined && body.ownerId !== me.id)
      throw new AppError(403, 'Chỉ Manager chọn người phụ trách khác khi tạo khách hàng.');
    if (!update && body.ownerId !== undefined && body.ownerId !== null && typeof body.ownerId !== 'string')
      throw new AppError(400, 'Nhân viên phụ trách không hợp lệ.');
    const wanted = me.role === 'manager' && body.ownerId === null ? null
      : me.role === 'manager' && typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : me.id;
    const [ownerId] = update || !wanted ? [] : await activeStaff(c.env.db, [wanted]);
    if (!update && wanted && !ownerId) throw new AppError(400, 'Nhân viên phụ trách không còn hoạt động.');
    const sharedIds = initial?.sharedIds.filter(id => id !== ownerId) ?? [];
    if (sharedIds.length && (await activeStaff(c.env.db, sharedIds)).length !== sharedIds.length)
      throw new AppError(400, 'Danh sách chia sẻ có nhân viên không hợp lệ hoặc đã ngừng hoạt động.');
    // Khách nhân viên tạo chờ Manager duyệt mới dùng được cho báo giá / đơn; Manager tạo thì có hiệu lực ngay.
    const mgr = me.role === 'manager';
    await c.env.db.transaction(async tx => {
      await customerIdentityLock(tx);
      const [previous] = update ? await tx.select().from(customers).where(eq(customers.id, id)).for('update') : [];
      if (update && !previous) throw new AppError(404, 'Không tìm thấy khách hàng.');
      rejectDuplicate(await findCustomerDuplicates(tx, changedIdentity(fields, previous), update ? id : undefined), canListRetailCustomers(me));
      if (update) {
        await requireProfileEdit(tx as any,id,me);
        if(body.contacts!==undefined){
          const directory=await saveContactDirectory(tx as any,previous!,body.contacts,body.contactDirectoryVersion,me.id,now);
          Object.assign(row,directory,{search:fold(Object.values({...fields,contact:directory.contact}).join(' '))});
        }
        await tx.update(customers).set(row).where(eq(customers.id, id));
        return;
      }
      await tx.insert(customers).values({ id, createdAt: now, ...row, dataSource: 'web', approvalStatus: mgr ? 'approved' : 'pending', createdBy: me.id, approvedBy: mgr ? me.id : null, approvedAt: mgr ? now : null });
      if (ownerId) await tx.insert(customerStaff).values({ customerId: id, memberId: ownerId, role: 'owner', createdBy: me.id, createdAt: now });
      if (sharedIds.length) await tx.insert(customerStaff).values(sharedIds.map(memberId => ({ customerId: id, memberId, role: 'shared' as const, createdBy: me.id, createdAt: now })));
      if (initial?.notes) await tx.insert(customerNotes).values({ customerId: id, text: initial.notes, revision: 1, updatedBy: me.id, updatedAt: now });
      if (initial?.debtNote) await tx.insert(customerDebtNotes).values({ customerId: id, text: initial.debtNote, revision: 1, updatedBy: me.id, updatedAt: now });
      if (initial?.contacts.length) {
        const contactRows = initial.contacts.map(contact => ({ ...contact, id: crypto.randomUUID(), customerId: id, createdBy: me.id, createdAt: now, updatedAt: now }));
        await tx.insert(customerContacts).values(contactRows);
        const representativeId = contactRows[initial.representativeIndex]?.id;
        if (representativeId) await tx.update(customers).set({ representativeContactId: representativeId }).where(eq(customers.id, id));
      }
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      console.error('customer_save_transaction_failed');
      throw new AppError(500, 'Không lưu được hồ sơ khách hàng. Các thay đổi trong lần lưu này đã được hủy.', 'CUSTOMER_SAVE_FAILED');
    });
    return update ? json({ id }) : json({ id, approvalStatus: mgr ? 'approved' : 'pending' }, 201);
  };
  router.post('/customers', c => save(c, false), 'business');
  router.put('/customers/:id', c => save(c, true), 'business');

  /** Duyệt khách mới: Manager hoặc nhân viên được Manager bật cờ "Được duyệt". */
  router.post('/customers/:id/approve', async c => {
    const me = viewer(c);
    if (!canApprove(me)) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt khách hàng mới.', 'APPROVER_ONLY');
    const now = nowIso();
    // Duyệt khách đang chờ, hoặc duyệt lại khách đã bị từ chối (xoá lý do từ chối cũ).
    const done = await c.env.db.update(customers).set({ approvalStatus: 'approved', approvedBy: me.id, approvedAt: now, rejectReason: null, rejectedBy: null, rejectedAt: null })
      .where(and(eq(customers.id, c.params.id!), inArray(customers.approvalStatus, ['pending', 'rejected']))).returning({ id: customers.id });
    if (!done.length) throw new AppError(404, 'Không tìm thấy khách hàng đang chờ duyệt hoặc bị từ chối.');
    return json({ ok: true });
  }, 'business');
  /** Từ chối khách đang chờ duyệt (người duyệt): giữ hồ sơ, bắt buộc có lý do. Khách bị từ chối không dùng được cho báo giá / đơn / cổng khách. */
  router.post('/customers/:id/reject', async c => {
    const me = viewer(c);
    if (!canApprove(me)) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định từ chối khách hàng mới.', 'APPROVER_ONLY');
    const body = await readJson(c.req, 4_096), reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 1000) throw new AppError(400, 'Nhập lý do từ chối (tối đa 1.000 ký tự).', 'REJECT_REASON_REQUIRED');
    const done = await c.env.db.update(customers).set({ approvalStatus: 'rejected', rejectReason: reason, rejectedBy: me.id, rejectedAt: nowIso() })
      .where(and(eq(customers.id, c.params.id!), eq(customers.approvalStatus, 'pending'))).returning({ id: customers.id });
    if (!done.length) throw new AppError(404, 'Không tìm thấy khách hàng đang chờ duyệt.');
    return json({ ok: true });
  }, 'business');
  /** Gửi duyệt lại khách bị từ chối sau khi đã sửa: người tạo hoặc người duyệt. */
  router.post('/customers/:id/resubmit', async c => {
    const me = viewer(c), db = c.env.db;
    const [row] = await db.select({ approvalStatus: customers.approvalStatus, createdBy: customers.createdBy }).from(customers).where(eq(customers.id, c.params.id!)).limit(1);
    if (!row || row.approvalStatus !== 'rejected') throw new AppError(404, 'Không tìm thấy khách hàng bị từ chối.');
    if (!canApprove(me) && row.createdBy !== me.id) throw new AppError(403, 'Chỉ người tạo hoặc người duyệt gửi duyệt lại được khách hàng này.');
    await db.update(customers).set({ approvalStatus: 'pending', rejectReason: null, rejectedBy: null, rejectedAt: null })
      .where(and(eq(customers.id, c.params.id!), eq(customers.approvalStatus, 'rejected')));
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
      await tx.select({id:customers.id}).from(customers).where(eq(customers.id,id)).for('update');
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
  const contactFields = customerContactInput;
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
    const db=c.env.db,id=c.params.id!,me=viewer(c),fields=contactFields(await readJson(c.req,8_000)),now=nowIso(),contactId=crypto.randomUUID();
    await requireProfileEdit(db,id,me);
    await db.transaction(async tx=>{
      const customer=await lockContactCustomer(tx as any,id);await requireProfileEdit(tx as any,id,me);await ensureLegacyContact(tx as any,customer,me.id,now);
      const [{n=0}={}]=await tx.select({n:count()}).from(customerContacts).where(eq(customerContacts.customerId,id));
      if(Number(n)>=CUSTOMER_LIMITS.contacts)throw new AppError(400,`Mỗi khách tối đa ${CUSTOMER_LIMITS.contacts} người liên hệ.`);
      if(fields.isPrimary)await tx.update(customerContacts).set({isPrimary:false}).where(eq(customerContacts.customerId,id));
      await tx.insert(customerContacts).values({...fields,id:contactId,customerId:id,createdBy:me.id,createdAt:now,updatedAt:now});
      await syncPrimaryContact(tx as any,customer);
    });
    return json({id:contactId},201);
  },'business');
  router.put('/customers/:id/contacts/:contactId',async c=>{
    const db=c.env.db,id=c.params.id!,me=viewer(c),fields=contactFields(await readJson(c.req,8_000)),now=nowIso();
    await requireProfileEdit(db,id,me);
    await db.transaction(async tx=>{
      const customer=await lockContactCustomer(tx as any,id);await requireProfileEdit(tx as any,id,me);await ensureLegacyContact(tx as any,customer,me.id,now);
      const done=await tx.update(customerContacts).set({...fields,updatedAt:now}).where(and(eq(customerContacts.id,c.params.contactId!),eq(customerContacts.customerId,id))).returning({id:customerContacts.id});
      if(!done.length)throw new AppError(404,'Không tìm thấy người liên hệ.');
      if(fields.isPrimary)await tx.update(customerContacts).set({isPrimary:false}).where(and(eq(customerContacts.customerId,id),ne(customerContacts.id,c.params.contactId!)));
      await syncPrimaryContact(tx as any,customer);
    });return json({ok:true});
  },'business');
  router.delete('/customers/:id/contacts/:contactId',async c=>{
    const db=c.env.db,id=c.params.id!,me=viewer(c),now=nowIso();await requireProfileEdit(db,id,me);
    await db.transaction(async tx=>{
      const customer=await lockContactCustomer(tx as any,id);await requireProfileEdit(tx as any,id,me);await ensureLegacyContact(tx as any,customer,me.id,now);
      const done=await tx.delete(customerContacts).where(and(eq(customerContacts.id,c.params.contactId!),eq(customerContacts.customerId,id))).returning({id:customerContacts.id});
      if(!done.length)throw new AppError(404,'Không tìm thấy người liên hệ.');
      await syncPrimaryContact(tx as any,customer);
    });return json({ok:true});
  },'business');
}

