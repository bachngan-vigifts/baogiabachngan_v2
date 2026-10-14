import { and, asc, count, eq, ilike, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { incomingShipments, supplierAccounts, supplierContacts, suppliers } from '../schema.ts';
import { canManageSuppliers, cleanContacts, cleanSupplierInput, planAccountLink } from '../domain/directory.ts';

/**
 * DANH BẠ NHÀ CUNG CẤP (đợt 1 – Manager, khu vực `ncc-admin`). Xem docs/NCC-PAGE.md, mục "Quản lý NCC".
 *  GET  /suppliers                    danh sách (?q=, ?active=0|1) kèm số liên hệ / tài khoản / đơn
 *  POST /suppliers                    thêm NCC (+ contacts)                                  – trùng tên (bỏ dấu) → 409
 *  GET  /suppliers/:id                chi tiết: NCC + liên hệ + tài khoản đăng nhập
 *  PUT  /suppliers/:id                sửa thông tin, liên hệ (thay cả danh sách), ngừng / mở lại (`active`), `updatedAt` chống ghi đè
 *  PUT  /suppliers/:id/accounts       đặt danh sách tài khoản NCC đăng nhập thay mặt NCC này (`memberIds`)
 *  GET  /supplier-account-candidates  tài khoản chức vụ NCC đang hoạt động (và đang gắn NCC nào)
 * Không xoá NCC: đơn cũ tham chiếu → chỉ ngừng hoạt động.
 */
type Ctx = RouteContext<StaffEnv>;
const member = (c: Ctx) => (c.state.session as SessionState).member;
const requireManager = (c: Ctx) => { if (!canManageSuppliers(member(c))) throw new AppError(403, 'Chỉ Manager được quản lý nhà cung cấp.'); };
const nowIso = () => new Date().toISOString();

async function loadSupplier(db: StaffEnv['db'], id: string) {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy nhà cung cấp.');
  return row;
}
async function nameTaken(db: StaffEnv['db'], nameKey: string, exceptId?: string) {
  const [row] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.nameKey, nameKey), exceptId ? ne(suppliers.id, exceptId) : undefined)).limit(1);
  return Boolean(row);
}

export async function supplierDetail(db: StaffEnv['db'], id: string) {
  const supplier = await loadSupplier(db, id);
  const [contacts, accounts, [{ orders = 0 } = {}]] = await Promise.all([
    db.select({ id: supplierContacts.id, kind: supplierContacts.kind, name: supplierContacts.name, email: supplierContacts.email, phone: supplierContacts.phone })
      .from(supplierContacts).where(eq(supplierContacts.supplierId, id)).orderBy(asc(supplierContacts.kind), asc(supplierContacts.createdAt)),
    db.select({ id: employees.id, name: employees.name, email: employees.email, active: employees.active })
      .from(supplierAccounts).innerJoin(employees, eq(employees.id, supplierAccounts.memberId)).where(eq(supplierAccounts.supplierId, id)).orderBy(asc(employees.name)),
    db.select({ orders: count() }).from(incomingShipments).where(eq(incomingShipments.supplierId, id)),
  ]);
  return { supplier, contacts, accounts, orders: Number(orders) };
}

export function registerSupplierDirectoryRoutes(router: Router<StaffEnv>) {
  router.get('/suppliers', async c => {
    requireManager(c);
    const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 100), active = c.url.searchParams.get('active');
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const where = and(q ? or(ilike(suppliers.name, like), ilike(suppliers.taxCode, like), ilike(suppliers.phone, like), ilike(suppliers.email, like)) : undefined,
      active === '1' ? eq(suppliers.active, true) : active === '0' ? eq(suppliers.active, false) : undefined);
    const rows = await c.env.db.select().from(suppliers).where(where).orderBy(asc(suppliers.active), asc(suppliers.name)).limit(500);
    const ids = rows.map(r => r.id);
    const [contacts, accounts, orders] = ids.length ? await Promise.all([
      c.env.db.select({ id: supplierContacts.supplierId, n: count() }).from(supplierContacts).where(inArray(supplierContacts.supplierId, ids)).groupBy(supplierContacts.supplierId),
      c.env.db.select({ id: supplierAccounts.supplierId, n: count() }).from(supplierAccounts).where(inArray(supplierAccounts.supplierId, ids)).groupBy(supplierAccounts.supplierId),
      c.env.db.select({ id: incomingShipments.supplierId, n: count() }).from(incomingShipments).where(inArray(incomingShipments.supplierId, ids)).groupBy(incomingShipments.supplierId),
    ]) : [[], [], []];
    const by = (list: { id: string | null; n: number }[]) => new Map(list.map(r => [r.id, Number(r.n)]));
    const [cm, am, om] = [by(contacts), by(accounts), by(orders)];
    // Đang hoạt động trước, rồi theo tên.
    rows.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'vi'));
    return json({ suppliers: rows.map(r => ({ ...r, contacts: cm.get(r.id) ?? 0, accounts: am.get(r.id) ?? 0, orders: om.get(r.id) ?? 0 })) });
  }, 'ncc-admin');

  router.post('/suppliers', async c => {
    requireManager(c);
    const body = await readJson(c.req, 32_768), clean = cleanSupplierInput(body), contacts = cleanContacts(body.contacts ?? []);
    const db = c.env.db, now = nowIso(), id = crypto.randomUUID(), me = member(c);
    if (await nameTaken(db, clean.nameKey)) throw new AppError(409, 'Đã có nhà cung cấp trùng tên.');
    await db.transaction(async tx => {
      const ok = await tx.insert(suppliers).values({ id, ...clean, active: true, createdAt: now, createdBy: me.id, updatedAt: now, updatedBy: me.id })
        .onConflictDoNothing({ target: suppliers.nameKey }).returning({ id: suppliers.id });
      if (!ok.length) throw new AppError(409, 'Đã có nhà cung cấp trùng tên.');
      if (contacts.length) await tx.insert(supplierContacts).values(contacts.map(ct => ({ id: crypto.randomUUID(), supplierId: id, ...ct, createdAt: now })));
    });
    return json(await supplierDetail(db, id), 201);
  }, 'ncc-admin');

  router.get('/suppliers/:id', async c => { requireManager(c); return json(await supplierDetail(c.env.db, c.params.id!)); }, 'ncc-admin');

  router.put('/suppliers/:id', async c => {
    requireManager(c);
    const db = c.env.db, id = c.params.id!, body = await readJson(c.req, 32_768), me = member(c), current = await loadSupplier(db, id);
    if (typeof body.updatedAt === 'string' && body.updatedAt !== current.updatedAt) throw new AppError(409, 'Nhà cung cấp vừa được người khác sửa. Tải lại rồi thử lại.');
    const clean = cleanSupplierInput(body), contacts = body.contacts === undefined ? null : cleanContacts(body.contacts);
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new AppError(400, 'Trạng thái không hợp lệ.');
    if (await nameTaken(db, clean.nameKey, id)) throw new AppError(409, 'Đã có nhà cung cấp trùng tên.');
    const now = nowIso();
    await db.transaction(async tx => {
      // Khoá lạc quan: chỉ ghi khi `updated_at` chưa đổi kể từ lúc đọc.
      const ok = await tx.update(suppliers).set({ ...clean, ...(typeof body.active === 'boolean' ? { active: body.active as boolean } : {}), updatedAt: now, updatedBy: me.id })
        .where(and(eq(suppliers.id, id), eq(suppliers.updatedAt, current.updatedAt))).returning({ id: suppliers.id });
      if (!ok.length) throw new AppError(409, 'Nhà cung cấp vừa được người khác sửa. Tải lại rồi thử lại.');
      if (contacts) {
        await tx.delete(supplierContacts).where(eq(supplierContacts.supplierId, id));
        if (contacts.length) await tx.insert(supplierContacts).values(contacts.map(ct => ({ id: crypto.randomUUID(), supplierId: id, ...ct, createdAt: now })));
      }
    });
    return json(await supplierDetail(db, id));
  }, 'ncc-admin');

  router.put('/suppliers/:id/accounts', async c => {
    requireManager(c);
    const db = c.env.db, id = c.params.id!, body = await readJson(c.req, 8_192), me = member(c);
    const ids = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.filter((x: unknown): x is string => typeof x === 'string'))] : null;
    if (!ids || ids.length > 50) throw new AppError(400, 'Danh sách tài khoản không hợp lệ.');
    const supplier = await loadSupplier(db, id);
    const members = ids.length ? await db.select({ id: employees.id, role: employees.role, active: employees.active, positionId: employees.positionId, deletedAt: employees.deletedAt }).from(employees).where(inArray(employees.id, ids)) : [];
    const plans = ids.map(mid => { const m = members.find(x => x.id === mid); return planAccountLink(me, m && !m.deletedAt ? m : null, supplier); });
    const now = nowIso();
    await db.transaction(async tx => {
      await tx.delete(supplierAccounts).where(and(eq(supplierAccounts.supplierId, id), ids.length ? notInArray(supplierAccounts.memberId, ids) : undefined));
      // Mỗi tài khoản thuộc đúng một NCC: gắn sang NCC này thì bỏ gắn ở NCC cũ.
      for (const p of plans) await tx.insert(supplierAccounts).values({ ...p, createdAt: now, createdBy: me.id })
        .onConflictDoUpdate({ target: supplierAccounts.memberId, set: { supplierId: p.supplierId, createdAt: now, createdBy: me.id } });
    });
    return json(await supplierDetail(db, id));
  }, 'ncc-admin');

  router.get('/supplier-account-candidates', async c => {
    requireManager(c);
    const rows = await c.env.db.select({ id: employees.id, name: employees.name, email: employees.email, role: employees.role, positionId: employees.positionId, supplierId: supplierAccounts.supplierId, supplierName: suppliers.name })
      .from(employees).leftJoin(supplierAccounts, eq(supplierAccounts.memberId, employees.id)).leftJoin(suppliers, eq(suppliers.id, supplierAccounts.supplierId))
      .where(and(eq(employees.active, true), isNull(employees.deletedAt), or(eq(employees.role, 'supplier'), eq(employees.positionId, 'supplier')))).orderBy(asc(employees.name));
    return json({ accounts: rows.map(({ role: _r, positionId: _p, ...r }) => r) });
  }, 'ncc-admin');
}
